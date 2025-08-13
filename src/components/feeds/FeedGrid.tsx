"use client";
/* eslint-disable @next/next/no-img-element */

import useSWR from "swr";
import { Image as ImageIcon, RefreshCcw, CalendarDays, Play, Loader2, Square, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { cacheImagesForItems, cacheImagesForFeed, loadFeedItemsFromCache, saveFeedItemsToCache } from "@/lib/feed-cache";
import { getFeedsByIds } from "@/lib/feeds-store";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { useMemo, useState, useEffect } from "react";
import { t, useLang } from "@/lib/i18n";
import { ReaderModal } from "./ReaderModal";

type FeedGridProps = {
  feedIds: string[];
  refreshKey?: number; // pour forcer re-render lors d’un rename
};

type Article = {
  id: string;
  title: string;
  link?: string;
  pubDate?: string;
  contentSnippet?: string;
  image?: string;
  feedTitle?: string;
};

async function fetcher<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error("Erreur de chargement");
  }
  return res.json();
}

export function FeedGrid({ feedIds, refreshKey }: FeedGridProps) {
  const feeds = getFeedsByIds(feedIds);
  const [lang] = useLang();
  const [filter, setFilter] = useState<"all" | "today">("all");
  const [manualRefresh, setManualRefresh] = useState(0);

  // Lecture / génération audio (doivent être déclarés avant tout early-return)
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);
  // Identifiant spécial pour l'audio "digest du jour"
  const DIGEST_ID = "__digest__";
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [readerOpen, setReaderOpen] = useState(false);
  const [readerArticle, setReaderArticle] = useState<{ title: string; link?: string; pubDate?: string; image?: string } | null>(null);

  useEffect(() => {
    const on = (e: Event) => {
      const detail = (e as CustomEvent).detail as { article?: Article } | undefined;
      if (detail?.article) {
        setReaderArticle({ title: detail.article.title, link: detail.article.link, pubDate: detail.article.pubDate, image: detail.article.image });
        setReaderOpen(true);
      }
    };
    window.addEventListener("flux:reader:open", on as EventListener);
    return () => window.removeEventListener("flux:reader:open", on as EventListener);
  }, []);

  function stopPlayback() {
    try {
      if (audioEl) {
        audioEl.pause();
        audioEl.currentTime = 0;
      }
    } catch {}
    setPlayingId(null);
  }

  function isYouTubeUrl(url?: string): boolean {
    if (!url) return false;
    try {
      const u = new URL(url);
      const h = u.hostname.replace(/^www\./, "");
      return (
        h === "youtube.com" ||
        h === "youtu.be" ||
        h === "m.youtube.com" ||
        h.endsWith("youtube-nocookie.com")
      );
    } catch {
      return false;
    }
  }

  // util parent non utilisé, remplacé par util locales

  function getYouTubeEmbed(url?: string): string | null {
    if (!url) return null;
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./, "");
      let id = "";
      if (host === "youtu.be") {
        id = u.pathname.slice(1);
      } else {
        id = u.searchParams.get("v") || "";
        if (!id && u.pathname.startsWith("/embed/")) id = u.pathname.split("/embed/")[1] || "";
      }
      if (!id) return null;
      const params = new URLSearchParams();
      const start = u.searchParams.get("t") || u.searchParams.get("start");
      if (start) params.set("start", start);
      params.set("autoplay", "1");
      params.set("playsinline", "1");
      params.set("rel", "0");
      params.set("modestbranding", "1");
      return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?${params.toString()}`;
    } catch {
      return null;
    }
  }

  function openVideoOverlay(url?: string) {
    if (!url) return;
    if (!isYouTubeUrl(url)) return;
    const embed = getYouTubeEmbed(url);
    if (!embed) return;
    setVideoUrl(embed);
  }

  async function playArticle(article: Article) {
    // Consommer 1 token pour TTS article
    try {
      window.dispatchEvent(new Event("flux:ai:token:consume"));
    } catch {}
    if (!article.link) return;
    setGeneratingId(article.id);
    try {
      // 1) Récupération d'un vrai résumé narratif pour l'audio (pas la version structurée du lecteur)
      let apiKey = "";
      try { apiKey = localStorage.getItem("flux:ai:openai") || ""; } catch {}
      const res = await fetch("/api/ai/summarize-tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: article.link, lang, apiKey: apiKey || undefined, textOnly: true, mode: "audio" }),
      });
      const errJson = (!res.ok ? await safeJson(res) : null) as { error?: string; stage?: string } | null;
      if (!res.ok) {
        const stage = errJson?.stage ? ` (étape: ${errJson.stage})` : "";
        if (res.status === 401) toast.error(t(lang, "openAiMissing"));
        else if (res.status === 400 || res.status === 422 || res.status === 502) toast.error((errJson?.error || t(lang, "articleExtractFailed")) + stage);
        else if (res.status >= 500) toast.error((errJson?.error || t(lang, "serverGenError")) + stage);
        throw new Error((errJson?.error || `Echec génération (${res.status})`) + stage);
      }
      const json = (await res.json()) as { text: string };

      // 2) Synthèse vocale côté client (évite les timeouts Netlify)
      if (!apiKey) {
        toast.error(t(lang, "openAiMissing"));
        return;
      }
      const voice = (localStorage.getItem("flux:ai:voice") as string) || "alloy";
      const controller = new AbortController();
      const tTimeout = setTimeout(() => controller.abort(), 26000);
      const ttsRes = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: json.text, lang, apiKey, voice }),
        signal: controller.signal,
      });
      clearTimeout(tTimeout);
      if (!ttsRes.ok) {
        const e = await ttsRes.text().catch(() => "");
        throw new Error(`TTS failed: ${e || ttsRes.status}`);
      }
      const ttsJson = (await ttsRes.json()) as { audio: string };
      const blob = base64ToBlob(ttsJson.audio, "audio/mpeg");
      const url = URL.createObjectURL(blob);
      if (audioEl) {
        try { audioEl.pause(); } catch {}
      }
      const audio = new Audio(url);
      setAudioEl(audio);
      setPlayingId(article.id);
      audio.onended = () => {
        setPlayingId((pid) => (pid === article.id ? null : pid));
        try { URL.revokeObjectURL(url); } catch {}
      };
      await audio.play();
      toast.success(t(lang, "playbackStarted"));
    } catch (e) {
      console.error(e);
      // les toasts d'erreur sont gérés ci-dessus
    } finally {
      setGeneratingId((gid) => (gid === article.id ? null : gid));
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async function playDigestForToday() {
    // Récupère uniquement les articles d'aujourd'hui (toutes colonnes)
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const todays = (data?.items || []).filter((a) => {
      if (!a.pubDate) return false;
      const d = new Date(a.pubDate);
      return d >= start && d <= end;
    });
    if (todays.length === 0) {
      toast.error(t(lang, "noArticlesToday"));
      return;
    }
    setGeneratingId(DIGEST_ID);
    try {
      let apiKey = "";
      try {
        apiKey = localStorage.getItem("flux:ai:openai") || "";
      } catch {}
      const voice = localStorage.getItem("flux:ai:voice") || undefined;
      const items = todays.slice(0, 30).map((a) => ({ title: a.title, snippet: a.contentSnippet }));
      const sourceTitle = getHeaderTitle(feeds.map((f) => ({ title: f.title, url: f.url })));
      const res = await fetch("/api/ai/summarize-tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, sourceTitle, lang, apiKey: apiKey || undefined, voice }),
      });
      const errJson = (!res.ok ? await safeJson(res) : null) as { error?: string; stage?: string } | null;
      if (!res.ok) {
        const stage = errJson?.stage ? ` (étape: ${errJson.stage})` : "";
        if (res.status === 401) {
          toast.error(t(lang, "openAiMissing"));
        } else if (res.status === 400 || res.status === 422 || res.status === 502) {
          toast.error((errJson?.error || t(lang, "dailySummaryFailed")) + stage);
        } else if (res.status >= 500) {
          toast.error((errJson?.error || t(lang, "serverGenError")) + stage);
        }
        throw new Error((errJson?.error || `Echec génération audio (${res.status})`) + stage);
      }
      const json = (await res.json()) as { audio: string; text: string };
      if (audioEl) {
        try { audioEl.pause(); } catch {}
      }
      const audio = new Audio(`data:audio/mp3;base64,${json.audio}`);
      setAudioEl(audio);
      setPlayingId(DIGEST_ID);
      audio.onended = () => setPlayingId((pid) => (pid === DIGEST_ID ? null : pid));
      await audio.play();
      toast.success(t(lang, "playbackStarted"));
    } catch (e) {
      console.error(e);
    } finally {
      setGeneratingId((gid) => (gid === DIGEST_ID ? null : gid));
    }
  }

  type BatchResponse = { items: Article[] };
  // Pré-remplir avec cache local (client) si dispo, puis revalider chaque heure
  const initialFromCache = feeds.flatMap((f) => loadFeedItemsFromCache(f.url));
  const { data, error, isLoading, isValidating, mutate } = useSWR<BatchResponse>(
    feeds.length > 0 ? ["/api/feeds/batch", { feeds: feeds.map((f) => f.url) }, refreshKey, manualRefresh] : null,
    ([url, body]) => fetcher<BatchResponse>(url as string, body),
    { revalidateOnFocus: false, refreshInterval: 60 * 60 * 1000, fallbackData: initialFromCache.length ? { items: initialFromCache } : undefined }
  );

  const allArticles: Article[] = useMemo(() => data?.items || [], [data?.items]);
  const articles: Article[] = useMemo(() => {
    if (filter !== "today") return allArticles;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return allArticles.filter((a) => {
      if (!a.pubDate) return false;
      const d = new Date(a.pubDate);
      return d >= start && d <= end;
    });
  }, [allArticles, filter]);

  // Sauvegarder/mettre en cache tous les articles récupérés (pas seulement ceux filtrés)
  if (allArticles.length && feeds.length) {
    const bySource: Record<string, Article[]> = {};
    for (const a of allArticles) {
      if (!a.link) continue;
      const src = findSourceForLink(a.link, feeds.map((f) => f.url));
      if (!src) continue;
      (bySource[src] ||= []).push(a);
    }
    for (const src of Object.keys(bySource)) {
      const itemsForSrc = bySource[src].map((x) => ({ ...x, source: src }));
      saveFeedItemsToCache(src, itemsForSrc);
      void cacheImagesForFeed(src, itemsForSrc);
    }
    // Fallback global pour les pages sans source identifiée
    void cacheImagesForItems(allArticles);
  }

  if (isLoading || (!data && isValidating)) {
    return <SkeletonGrid />;
  }
  if (error) {
    return <div className="p-6 text-sm">Erreur de chargement</div>;
  }

  const headerTitle = getHeaderTitle(feeds.map((f) => ({ title: f.title, url: f.url })));

  // Lecture / génération audio (au niveau article uniquement)
  const featured: Article | undefined = articles[0];
  const rest: Article[] = articles.slice(1);

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          {headerTitle && <h1 className="text-4xl md:text-5xl font-bold">{headerTitle}</h1>}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={`text-xs px-2.5 py-1.5 rounded border ${filter === "all" ? "bg-foreground text-background" : "bg-transparent"}`}
            onClick={() => setFilter("all")}
            aria-pressed={filter === "all"}
            title={t(lang, "showAll")}
          >
            {t(lang, "showAll")}
          </button>
          <button
            type="button"
            className={`text-xs px-2.5 py-1.5 rounded border ${filter === "today" ? "bg-foreground text-background" : "bg-transparent"}`}
            onClick={() => setFilter("today")}
            aria-pressed={filter === "today"}
            title={t(lang, "todayOnly")}
          >
            <CalendarDays className="w-3.5 h-3.5 inline -mt-0.5 mr-1" /> {t(lang, "todayOnly")}
          </button>
          <button
            type="button"
            className="text-xs px-2.5 py-1.5 rounded border bg-transparent hover:bg-foreground hover:text-background transition-colors"
            onClick={async () => {
              setManualRefresh((n) => n + 1);
              await mutate();
            }}
            title={t(lang, "refresh")}
          >
            <RefreshCcw className="w-3.5 h-3.5 inline -mt-0.5 mr-1" /> {t(lang, "refresh")}
          </button>
        </div>
      </div>
      {articles.length === 0 ? (
        <div className="h-[60vh] grid place-items-center">
          <div className="text-center max-w-md mx-auto px-6 py-8 border rounded-xl">
            <div className="text-2xl mb-2">📰</div>
            <h2 className="text-lg font-semibold mb-1">{t(lang, "noArticles")}</h2>
          </div>
        </div>
      ) : (
        <>
          {featured && (
        <FeaturedArticleCard
              article={featured}
              isGenerating={generatingId === featured.id}
              isPlaying={playingId === featured.id}
          onPlay={() => void playArticle(featured)}
          onOpenVideo={() => openVideoOverlay(featured.link)}
              onStop={() => stopPlayback()}
            />
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
            {rest.map((a) => (
          <ArticleCard
                key={a.id}
                article={a}
                isGenerating={generatingId === a.id}
                isPlaying={playingId === a.id}
            onPlay={() => void playArticle(a)}
                onStop={() => stopPlayback()}
              />
            ))}
          </div>
        </>
      )}
      <Dialog open={!!videoUrl} onOpenChange={(o) => !o && setVideoUrl(null)}>
        <DialogContent className="w-[90vw] max-w-[90vw] sm:max-w-[90vw] p-0 bg-black rounded-2xl overflow-hidden border-white/10" showCloseButton>
          <DialogTitle className="sr-only">Vidéo YouTube</DialogTitle>
          {videoUrl ? (
      <div className="relative w-full pt-[56.25%] rounded-2xl overflow-hidden">
              <iframe
                key={videoUrl}
                src={videoUrl}
                className="absolute inset-0 w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      {/* Gestion ouverture lecteur via event */}
      {/* Installer le listener une seule fois */}
      <ReaderModal
        open={readerOpen}
        onOpenChange={(o) => setReaderOpen(o)}
        article={readerArticle}
      />
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {Array.from({ length: 9 }).map((_, i) => (
        <div key={i} className="h-full">
          <div className="overflow-hidden border border-foreground/10 rounded-xl h-[350px] flex flex-col">
            <Skeleton className="h-[200px] w-full" />
            <div className="px-3 py-2 space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-[90%]" />
              <Skeleton className="h-4 w-[70%]" />
              <Skeleton className="h-3 w-[95%]" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ArticleCard({ article, isGenerating, isPlaying, onPlay, onStop }: { article: Article; isGenerating: boolean; isPlaying: boolean; onPlay: () => void; onStop: () => void }) {
  // util locales retirées (non utilisées dans cette carte)
  const [lang] = useLang();
  const [copied, setCopied] = useState(false);
  async function copyLink(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!article.link) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(article.link);
      } else {
        const ta = document.createElement("textarea");
        ta.value = article.link;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error(err);
      try { toast.error(t(lang, "clipboardError")); } catch {}
    }
  }

  return (
    <a href={article.link} target="_blank" rel="noreferrer" className="block h-full">
      <Card className="overflow-hidden border-foreground/10 hover:border-foreground/30 transition-colors h-[350px] flex flex-col p-0 gap-0">
        <div className="relative h-[200px] bg-muted overflow-hidden group">
          {article.image ? (
            <img
              src={`/api/proxy-image/${btoa(article.image).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")}`}
              alt=""
              className="block object-cover w-full h-full"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center">
              <ImageIcon className="w-6 h-6 text-muted-foreground/40" aria-hidden="true" />
            </div>
          )}
          {/* Boutons action: copier lien + lecteur */}
          {article.link ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="absolute right-2 top-2 rounded-full bg-black/60 text-white p-2 backdrop-blur-sm hover:bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={copyLink}
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </button>
              </TooltipTrigger>
              <TooltipContent>{copied ? t(lang, "linkCopied") : t(lang, "copyLink")}</TooltipContent>
            </Tooltip>
          ) : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="absolute right-2 top-12 rounded-full bg-black/60 text-white p-2 backdrop-blur-sm hover:bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const custom = new CustomEvent("flux:reader:open", { detail: { article } });
                  window.dispatchEvent(custom);
                }}
              >
                <span className="sr-only">{t(lang, "openReader")}</span>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                  <path d="M4 5a2 2 0 0 1 2-2h6a1 1 0 1 1 0 2H6v12h6a1 1 0 1 1 0 2H6a2 2 0 0 1-2-2V5zm12.293 1.293a1 1 0 0 1 1.414 0l3 3a1 1 0 0 1 0 1.414l-3 3A1 1 0 1 1 16.293 13H11a1 1 0 1 1 0-2h5.293l-1.586-1.586a1 1 0 0 1 0-1.414z" />
                </svg>
              </button>
            </TooltipTrigger>
            <TooltipContent>{t(lang, "openReader")}</TooltipContent>
          </Tooltip>
          {/* Bouton Play / Stop / Loader */}
          {!isPlaying && !isGenerating && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="absolute right-2 bottom-2 opacity-0 group-hover:opacity-100 transition-opacity rounded-full bg-black/60 text-white p-2 backdrop-blur-sm hover:bg-black/70"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onPlay();
                  }}
                >
                  <Play className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t(lang, "playAudioSummary")}</TooltipContent>
            </Tooltip>
          )}
          {isGenerating && (
            <span className="absolute right-2 bottom-2 rounded-full bg-black/60 text-white p-2 backdrop-blur-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
            </span>
          )}
          {isPlaying && !isGenerating && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="absolute right-2 bottom-2 rounded-full bg-black/60 text-white p-2 backdrop-blur-sm hover:bg-black/70"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onStop();
                  }}
                >
                  <Square className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t(lang, "stop")}</TooltipContent>
            </Tooltip>
          )}
        </div>
        <CardContent className="px-3 py-2 space-y-1 flex-1 flex flex-col overflow-hidden">
          <div className="text-xs text-muted-foreground shrink-0">
            {article.pubDate ? format(new Date(article.pubDate), "d MMM yyyy", { locale: fr }) : null}
          </div>
          <h3 className="font-medium leading-tight line-clamp-2">
            {article.title}
          </h3>
          {article.contentSnippet && (
            <p className="text-[13px] leading-snug text-muted-foreground line-clamp-3">
              {article.contentSnippet}
            </p>
          )}
        </CardContent>
      </Card>
    </a>
  );
}

function FeaturedArticleCard({ article, isGenerating, isPlaying, onPlay, onOpenVideo, onStop }: { article: Article; isGenerating: boolean; isPlaying: boolean; onPlay: () => void; onOpenVideo: () => void; onStop: () => void }) {
  const localIsYouTubeUrl = (url?: string) => {
    try {
      if (!url) return false;
      const u = new URL(url);
      const h = u.hostname.replace(/^www\./, "");
      return h === "youtube.com" || h === "youtu.be" || h === "m.youtube.com" || h.endsWith("youtube-nocookie.com");
    } catch { return false; }
  };
  const localIsProductHuntUrl = (url?: string) => {
    try {
      if (!url) return false;
      const u = new URL(url);
      const h = u.hostname.replace(/^www\./, "");
      return h === "producthunt.com" || h.endsWith(".producthunt.com");
    } catch { return false; }
  };
  const [lang] = useLang();
  const [copied, setCopied] = useState(false);
  const { luminance, overlayCss } = useImageLuminance(article.image);
  const isBright = typeof luminance === "number" ? luminance > 0.6 : false;
  const textClass = isBright ? "text-black" : "text-white";
  const subTextClass = isBright ? "text-black/70" : "text-white/80";

  async function copyLink(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!article.link) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(article.link);
      } else {
        const ta = document.createElement("textarea");
        ta.value = article.link;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error(err);
      try { toast.error("Impossible de copier le lien"); } catch {}
    }
  }

  return (
    <a
      href={article.link}
      target="_blank"
      rel="noreferrer"
      className="block w-full"
      onClick={(e) => {
        if (localIsYouTubeUrl(article.link)) {
          e.preventDefault();
          onOpenVideo();
        } else if (!localIsProductHuntUrl(article.link)) {
          e.preventDefault();
          const custom = new CustomEvent("flux:reader:open", { detail: { article } });
          window.dispatchEvent(custom);
        }
      }}
    >
      <div className="relative overflow-hidden border border-foreground/10 hover:border-foreground/30 transition-colors rounded-xl h-[420px] group">
        <div className="absolute inset-0 bg-muted" />
        {article.image ? (
          <img
            src={`/api/proxy-image/${btoa(article.image).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")}`}
            alt=""
            className="absolute inset-0 object-cover w-full h-full"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : null}
        {/* Blur progressif sous le texte pour lisibilité */}
        <div
          className="absolute inset-x-0 bottom-0 h-[60%] backdrop-blur-2xl z-[1]"
          style={{
            WebkitMaskImage:
              "linear-gradient(to top, rgba(0,0,0,1) 0%, rgba(0,0,0,0.9) 25%, rgba(0,0,0,0) 70%)",
            maskImage:
              "linear-gradient(to top, rgba(0,0,0,1) 0%, rgba(0,0,0,0.9) 25%, rgba(0,0,0,0) 70%)",
          }}
          aria-hidden="true"
        />
        {/* Overlay adaptatif */}
        <div
          className="absolute inset-0 z-[2]"
          style={{ background: overlayCss || "linear-gradient(to top, rgba(0,0,0,0.6), rgba(0,0,0,0))" }}
          aria-hidden="true"
        />
        {/* Bouton copier lien */}
        {article.link ? (
          <button
            type="button"
            className="absolute right-3 top-3 z-[4] rounded-full bg-black/60 text-white p-2 backdrop-blur-sm hover:bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity"
            title={copied ? t(lang, "linkCopied") : t(lang, "copyLink")}
            onClick={copyLink}
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          </button>
        ) : null}
        <div className="absolute inset-x-0 bottom-0 p-4 md:p-6 z-[3]">
          <div className={`text-xs mb-2 ${subTextClass}`}>
            {article.pubDate ? format(new Date(article.pubDate), "d MMM yyyy", { locale: fr }) : null}
          </div>
          <h2 className={`text-2xl md:text-3xl font-semibold leading-tight mb-2 ${textClass}`}>{article.title}</h2>
          {article.contentSnippet && (
            <p className={`text-sm md:text-base max-w-3xl line-clamp-3 drop-shadow ${subTextClass}`}>
              {article.contentSnippet}
            </p>
          )}
          <div className="mt-3">
            {!isPlaying && !isGenerating && (
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full bg-black/60 text-white px-3 py-1.5 backdrop-blur-sm hover:bg-black/70"
                title="Lire le résumé audio"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onPlay();
                }}
              >
                <Play className="w-4 h-4" />
                <span>Lire</span>
              </button>
            )}
            {isGenerating && (
              <span className="inline-flex items-center gap-2 rounded-full bg-black/60 text-white px-3 py-1.5 backdrop-blur-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Génération…</span>
              </span>
            )}
            {isPlaying && !isGenerating && (
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full bg-black/60 text-white px-3 py-1.5 backdrop-blur-sm hover:bg-black/70"
                title="Stop"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onStop();
                }}
              >
                <Square className="w-4 h-4" />
                <span>Stop</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </a>
  );
}

function useImageLuminance(imageUrl?: string) {
  const [luminance, setLuminance] = useState<number | null>(null);
  const [overlayCss, setOverlayCss] = useState<string | null>(null);

  useEffect(() => {
    if (!imageUrl) {
      setLuminance(null);
      setOverlayCss("linear-gradient(to top, rgba(0,0,0,0.6), rgba(0,0,0,0))");
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.referrerPolicy = "no-referrer";
    img.onload = () => {
      try {
        const w = 24;
        const h = 24;
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("noctx");
        ctx.drawImage(img, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;
        let sum = 0;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i] / 255;
          const g = data[i + 1] / 255;
          const b = data[i + 2] / 255;
          // relative luminance
          const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          sum += L;
        }
        const avg = sum / (w * h);
        if (!cancelled) {
          setLuminance(avg);
          const base = avg > 0.6 ? 0.35 : 0.6; // moins d'overlay si image claire
          setOverlayCss(
            `linear-gradient(to top, rgba(0,0,0,${base}) 0%, rgba(0,0,0,${Math.max(
              0,
              base - 0.25
            )}) 40%, rgba(0,0,0,0) 75%)`
          );
        }
      } catch {
        if (!cancelled) {
          setLuminance(null);
          setOverlayCss("linear-gradient(to top, rgba(0,0,0,0.6), rgba(0,0,0,0))");
        }
      }
    };
    img.onerror = () => {
      if (!cancelled) {
        setLuminance(null);
        setOverlayCss("linear-gradient(to top, rgba(0,0,0,0.6), rgba(0,0,0,0))");
      }
    };
    img.src = imageUrl;
    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  return { luminance, overlayCss };
}

  // Ancien handler non utilisé supprimé

type JsonUnknown = unknown;
async function safeJson(res: Response): Promise<JsonUnknown | null> {
  try { return (await res.json()) as unknown; } catch { return null; }
}

function findSourceForLink(link: string, sources: string[]): string | null {
  try {
    const u = new URL(link);
    for (const s of sources) {
      try {
        const su = new URL(s);
        if (u.hostname.endsWith(su.hostname)) return s;
      } catch {}
    }
  } catch {}
  return null;
}

function getHeaderTitle(list: { title: string; url: string }[]): string {
  if (!list.length) return "";
  if (list.length === 1) return list[0].title || list[0].url;
  const names = list.map((x) => x.title || x.url);
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} +${names.length - 3}`;
}

function base64ToBlob(base64: string, type = "application/octet-stream"): Blob {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes.buffer], { type });
}


