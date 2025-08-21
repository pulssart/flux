"use client";
/* eslint-disable @next/next/no-img-element */

import useSWR from "swr";
import { Image as ImageIcon, RefreshCcw, CalendarDays, Copy, Check, Settings2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { cacheImagesForItems, cacheImagesForFeed, loadFeedItemsFromCache, saveFeedItemsToCache } from "@/lib/feed-cache";
import { getFeedsByIds } from "@/lib/feeds-store";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle, DialogHeader, DialogFooter } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { useMemo, useState, useEffect } from "react";
import { t, useLang } from "@/lib/i18n";
// ReaderModal supprimé (suppression fonctionnalités IA)

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

// ---------- Favicons helpers (portée globale du fichier) ----------
function getFaviconUrl(u?: string | null): string | null {
  if (!u) return null;
  try {
    const { hostname } = new URL(u);
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
  } catch {
    return null;
  }
}

function FaviconInline({ url, size = 16, className }: { url?: string; size?: number; className?: string }) {
  const [ok, setOk] = useState(true);
  const src = getFaviconUrl(url);
  if (!src || !ok) return <span className={`inline-block rounded-sm bg-foreground/10`} style={{ width: size, height: size }} />;
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className={className || "inline-block rounded-sm object-contain"}
      referrerPolicy="no-referrer"
      onError={() => setOk(false)}
    />
  );
}

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

  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [writeOpen, setWriteOpen] = useState(false);
  const [writingArticle, setWritingArticle] = useState<Article | null>(null);
  const [xStyle, setXStyle] = useState<string>(() => {
    try { return localStorage.getItem("flux:xpost:style") || "casual"; } catch { return "casual"; }
  });
  const [postText, setPostText] = useState("");
  const [generatingPost, setGeneratingPost] = useState(false);

  // (les helpers favicons sont maintenant portés en haut du fichier)

  // Événements lecteur supprimés

  // Contrôles audio supprimés

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

  function openWriteModal(article: Article) {
    setWritingArticle(article);
    setPostText("");
    setWriteOpen(true);
  }

  function styleLabel(style: string): string {
    switch (style) {
      case "casual": return t(lang, "styleCasual");
      case "concise": return t(lang, "styleConcise");
      case "journalistic": return t(lang, "styleJournalistic");
      case "analytical": return t(lang, "styleAnalytical");
      case "enthusiastic": return t(lang, "styleEnthusiastic");
      case "technical": return t(lang, "styleTechnical");
      case "humorous": return t(lang, "styleHumorous");
      case "formal": return t(lang, "styleFormal");
      case "very_personal": return t(lang, "styleVeryPersonal");
      default: return style;
    }
  }

  async function fetchArticlePlainText(url?: string): Promise<string> {
    if (!url) return "";
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch("/api/article", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return "";
      const j = (await res.json()) as { contentHtml?: string };
      const html = j?.contentHtml || "";
      const div = document.createElement("div");
      div.innerHTML = html;
      const text = div.textContent || div.innerText || "";
      return text.replace(/\s+/g, " ").trim();
    } catch {
      return "";
    }
  }

  async function handleGeneratePost() {
    if (!writingArticle) return;
    const aiKey = (() => { try { return localStorage.getItem("flux:ai:openai") || ""; } catch { return ""; } })();
    if (!aiKey) { try { toast.error(t(lang, "openAiMissing")); } catch {} return; }
    setGeneratingPost(true);
    try {
      let summary = writingArticle.contentSnippet || "";
      const fullText = await fetchArticlePlainText(writingArticle.link);
      if (fullText) summary = fullText.slice(0, 1000);
      const res = await fetch("/api/ai/generate-x-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: writingArticle.title,
          summary,
          url: writingArticle.link || "",
          lang,
          apiKey: aiKey,
          style: xStyle,
          styleRef: (() => { try { return localStorage.getItem("flux:xpost:style:ref") || ""; } catch { return ""; } })(),
        }),
      });
      const j = (await res.json()) as { text?: string; error?: string };
      if (!res.ok || !j?.text) {
        throw new Error(j?.error || t(lang, "serverGenError"));
      }
      const base = j.text;
      let final = writingArticle.link ? `${base}\n\n${writingArticle.link}` : base;
      // Limiter à 350 caractères (après ajout du lien)
      final = final.slice(0, 350);
      setPostText(final);
    } catch (e) {
      try { toast.error((e as Error).message || t(lang, "serverGenError")); } catch {}
    } finally {
      setGeneratingPost(false);
    }
  }

  async function handleCopyPost() {
    try {
      await navigator.clipboard.writeText(postText);
      try { toast.success(t(lang, "postCopied")); } catch {}
    } catch {
      try { toast.error(t(lang, "clipboardError")); } catch {}
    }
  }

  async function handlePostOnX() {
    await handleCopyPost();
    try {
      const url = `https://x.com/intent/tweet?text=${encodeURIComponent(postText)}`;
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {}
  }

  // Lecture audio supprimée

  // Digest audio supprimé

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

  if (isLoading || isValidating) {
    return <SkeletonGrid />;
  }
  if (error) {
    return <div className="p-6 text-sm">Erreur de chargement</div>;
  }

  const headerTitle = getHeaderTitle(feeds.map((f) => ({ title: f.title, url: f.url })));

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
          <button
            type="button"
            className="text-xs px-2.5 py-1.5 rounded border bg-transparent hover:bg-foreground hover:text-background transition-colors"
            onClick={() => {
              try { window.dispatchEvent(new Event("flux:settings:open")); } catch {}
            }}
            title={t(lang, "settingsTooltip")}
            aria-label={t(lang, "settingsTooltip")}
          >
            <Settings2 className="w-3.5 h-3.5 inline -mt-0.5 mr-1" /> {t(lang, "settings")}
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
              onOpenVideo={() => openVideoOverlay(featured.link)}
              onWrite={() => openWriteModal(featured)}
            />
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
            {rest.map((a) => (
              <ArticleCard key={a.id} article={a} onWrite={() => openWriteModal(a)} />
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
      {/* Modale écriture X */}
      <Dialog open={writeOpen} onOpenChange={(o) => { setWriteOpen(o); if (!o) { setWritingArticle(null); setPostText(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t(lang, "writeAbout")}</DialogTitle>
          </DialogHeader>
          {writingArticle ? (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground line-clamp-2">{writingArticle.title}</div>
              <div className="flex items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">{t(lang, "writingStyleLabel")}: {styleLabel(xStyle)}</Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {[
                      "casual",
                      "concise",
                      "journalistic",
                      "analytical",
                      "enthusiastic",
                      "technical",
                      "humorous",
                      "formal",
                      "very_personal",
                    ].map((s) => (
                      <DropdownMenuItem key={s} onSelect={() => { setXStyle(s); try { localStorage.setItem("flux:xpost:style", s); } catch {} }}>
                        {styleLabel(s)}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button size="sm" onClick={() => void handleGeneratePost()} disabled={generatingPost}>
                  {generatingPost ? t(lang, "generatingPost") : t(lang, "generatePost")}
                </Button>
              </div>
              <div>
                <textarea
                  value={postText}
                  onChange={(e) => setPostText(e.target.value)}
                  placeholder={t(lang, "generatePost")}
                  className="w-full min-h-[160px] rounded-md border p-3 text-sm bg-transparent outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                />
              </div>
              <DialogFooter>
                <div className="flex items-center gap-2">
                  <Button variant="outline" onClick={() => void handleCopyPost()} disabled={!postText}>{t(lang, "copyPost")}</Button>
                  <Button onClick={() => void handlePostOnX()} disabled={!postText}>{t(lang, "postOnX")}</Button>
                </div>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      {/* Lecteur supprimé */}
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

function ArticleCard({ article, onWrite }: { article: Article; onWrite: () => void }) {
  // util locales retirées (non utilisées dans cette carte)
  const [lang] = useLang();
  const [copied, setCopied] = useState(false);
  const [hasHover, setHasHover] = useState<boolean>(true);
  useEffect(() => {
    try {
      setHasHover(window.matchMedia('(hover: hover)').matches);
    } catch {
      setHasHover(true);
    }
  }, []);
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

  // supprimé doublon hasHover

  return (
    <a href={article.link} target="_blank" rel="noreferrer" className="block h-full">
      <Card className="overflow-hidden border-foreground/10 hover:border-foreground/30 transition-colors flex flex-col p-0 gap-0">
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
          {/* Boutons action: copier lien + écrire */}
          {article.link ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={`absolute right-2 top-2 rounded-full bg-black/60 text-white p-2 backdrop-blur-sm hover:bg-black/70 transition-opacity ${hasHover ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'}`}
                  onClick={copyLink}
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </button>
              </TooltipTrigger>
              <TooltipContent>{copied ? t(lang, "linkCopied") : t(lang, "copyLink")}</TooltipContent>
            </Tooltip>
          ) : null}
          {article.link ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={`absolute right-12 top-2 rounded-full bg-black/60 text-white p-2 backdrop-blur-sm hover:bg-black/70 transition-opacity ${hasHover ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'}`}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); onWrite(); }}
                >
                  <Pencil className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t(lang, "writeAbout")}</TooltipContent>
            </Tooltip>
          ) : null}
          {/* Contrôles lecteur et audio supprimés */}
        </div>
        <CardContent className="px-3 py-2 space-y-1 flex-1 flex flex-col overflow-hidden">
          <div className="text-xs text-muted-foreground shrink-0 flex items-center gap-2">
            {article.link ? <FaviconInline url={article.link} size={16} /> : null}
            <span>{article.pubDate ? format(new Date(article.pubDate), "d MMM yyyy", { locale: fr }) : null}</span>
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

function FeaturedArticleCard({ article, onOpenVideo, onWrite }: { article: Article; onOpenVideo: () => void; onWrite: () => void }) {
  const localIsYouTubeUrl = (url?: string) => {
    try {
      if (!url) return false;
      const u = new URL(url);
      const h = u.hostname.replace(/^www\./, "");
      return h === "youtube.com" || h === "youtu.be" || h === "m.youtube.com" || h.endsWith("youtube-nocookie.com");
    } catch { return false; }
  };
  // util supprimée: localIsProductHuntUrl
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
        }
      }}
    >
      <div className="relative overflow-hidden border border-foreground/10 hover:border-foreground/30 transition-colors rounded-xl sm:h-[420px] group">
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
        {/* Boutons copier lien + écrire */}
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
        {article.link ? (
          <button
            type="button"
            className="absolute right-12 top-3 z-[4] rounded-full bg-black/60 text-white p-2 backdrop-blur-sm hover:bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity"
            title={t(lang, "writeAbout")}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onWrite(); }}
          >
            <Pencil className="w-4 h-4" />
          </button>
        ) : null}
        <div className="absolute inset-x-0 bottom-0 p-4 md:p-6 z-[3]">
          <div className={`text-xs mb-2 ${subTextClass} flex items-center gap-2`}>
            {article.link ? <FaviconInline url={article.link} size={18} className="inline-block rounded-sm" /> : null}
            <span>{article.pubDate ? format(new Date(article.pubDate), "d MMM yyyy", { locale: fr }) : null}</span>
          </div>
          <h2 className={`text-2xl md:text-3xl font-semibold leading-tight mb-2 ${textClass}`}>{article.title}</h2>
          {article.contentSnippet && (
            <p className={`text-sm md:text-base max-w-3xl line-clamp-3 drop-shadow ${subTextClass}`}>
              {article.contentSnippet}
            </p>
          )}
          <div className="mt-3" />
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


