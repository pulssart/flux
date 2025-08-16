"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, Image as ImageIcon, RefreshCcw, Trash2, LogIn, Play, Square, Settings2 } from "lucide-react";
import { useLang, t } from "@/lib/i18n";
import { format } from "date-fns";
import { fr as frLocale, enUS } from "date-fns/locale";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useTheme } from "next-themes";

export function Overview({ isMobile = false }: { isMobile?: boolean } = {}) {
  const [lang] = useLang();
  const { theme, setTheme, resolvedTheme } = useTheme();
  // Invalidation de cache lorsque le rendu évolue
  const OVERVIEW_RENDER_VERSION = "2025-08-14-2" as const;
  const [generating, setGenerating] = useState(false);
  const [content, setContent] = useState<
    | null
    | {
        html: string;
        items?: Array<{
          title: string;
          link: string | null;
          image: string | null;
          summary: string;
          host: string;
          pubDate: string | null;
        }>;
        intro?: string;
      }
  >(null);
  const generatingRef = useRef(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const [bgQuery, setBgQuery] = useState<string>("");
  const [bgOpen, setBgOpen] = useState<boolean>(false);
  const [unsplashKey, setUnsplashKey] = useState<string>("");
  const [unsplashResults, setUnsplashResults] = useState<Array<{ id: string; thumb: string | null; small: string | null; regular: string | null; full?: string | null }>>([]);
  const [loadingUnsplash, setLoadingUnsplash] = useState<boolean>(false);
  const [unsplashPage, setUnsplashPage] = useState<number>(1);
  const [unsplashHasMore, setUnsplashHasMore] = useState<boolean>(false);
  const fillingImagesRef = useRef(false);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const prevThemeRef = useRef<string | undefined>(undefined);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);
  const [digestPlaying, setDigestPlaying] = useState(false);
  const [digestGenerating, setDigestGenerating] = useState(false);
  const [digestPrepared, setDigestPrepared] = useState(false);
  const [articlePlayingId, setArticlePlayingId] = useState<string | null>(null);
  const [articleGeneratingId, setArticleGeneratingId] = useState<string | null>(null);
  const [preparedArticleId, setPreparedArticleId] = useState<string | null>(null);
  const [aiKeyOpen, setAiKeyOpen] = useState(false);
  const [aiKeyInput, setAiKeyInput] = useState("");
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (res.ok) {
          const j = (await res.json()) as { user: { email: string | null } | null };
          setSessionEmail(j.user?.email ?? null);
        }
      } catch {}
    })();
  }, []);

  // Forcer le dark mode en mobile (en conservant/restorant le thème précédent)
  useEffect(() => {
    if (!isMobile) return;
    try {
      if (!prevThemeRef.current) prevThemeRef.current = theme ?? resolvedTheme;
      if ((resolvedTheme || theme) !== "dark") setTheme("dark");
    } catch {}
    return () => {
      try {
        if (prevThemeRef.current && !isMobile) setTheme(prevThemeRef.current);
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile]);

  async function copyLinkToClipboard(url?: string | null) {
    if (!url) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const ta = document.createElement("textarea");
        ta.value = url;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      toast.success(t(lang, "linkCopied"));
    } catch {
      toast.error(t(lang, "clipboardError"));
    }
  }

  async function playTodayDigest() {
    // Si un audio a déjà été généré mais bloqué par l'autoplay mobile, retenter immédiatement
    if (digestPrepared && audioEl) {
      try {
        audioEl.onended = () => setDigestPlaying(false);
        await audioEl.play();
        setDigestPrepared(false);
        setDigestPlaying(true);
        toast.success(lang === "fr" ? "Lecture démarrée" : "Playback started");
        return;
      } catch {
        toast.error(lang === "fr" ? "Touchez à nouveau pour lire (autoplay bloqué)" : "Tap again to play (autoplay blocked)");
        return;
      }
    }
    try {
      // Consommer 1 token
      try { window.dispatchEvent(new Event("flux:ai:token:consume")); } catch {}
      const items = (content?.items || []).slice(0, 30).map((it) => ({ title: it.title, snippet: it.summary }));
      if (!items.length) {
        toast.error(lang === "fr" ? "Aucun article pour aujourd'hui" : "No items for today");
        return;
      }
      setDigestGenerating(true);
      let apiKey = "";
      try { apiKey = localStorage.getItem("flux:ai:openai") || ""; } catch {}
      const voice = (localStorage.getItem("flux:ai:voice") as string) || "alloy";
      const sourceTitle = `${dateTitle}`;
      const res = await fetch("/api/ai/summarize-tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, sourceTitle, lang, apiKey: apiKey || undefined, voice }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        if (res.status === 401) {
          try { setAiKeyInput(localStorage.getItem("flux:ai:openai") || ""); } catch { setAiKeyInput(""); }
          setAiKeyOpen(true);
        }
        toast.error((j?.error as string) || (lang === "fr" ? "Échec de génération audio" : "Audio generation failed"));
        return;
      }
      const j = (await res.json()) as { audio: string };
      if (audioEl) { try { audioEl.pause(); } catch {} }
      const blob = base64ToBlob(j.audio, "audio/mpeg");
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      setAudioEl(audio);
      setDigestPlaying(true);
      audio.onended = () => { setDigestPlaying(false); try { URL.revokeObjectURL(url); } catch {} };
      try {
        await audio.play();
        toast.success(lang === "fr" ? "Lecture démarrée" : "Playback started");
      } catch {
        // Laisser l'audio prêt et demander un second appui
        setDigestPlaying(false);
        setDigestPrepared(true);
        toast.error(lang === "fr" ? "Touchez à nouveau pour lire (autoplay bloqué)" : "Tap again to play (autoplay blocked)");
        return;
      }
    } catch (e) {
      console.error(e);
    } finally {
      setDigestGenerating(false);
    }
  }

  function stopDigest() {
    try {
      if (audioEl) {
        audioEl.pause();
        try { if (audioEl.src && audioEl.src.startsWith("blob:")) URL.revokeObjectURL(audioEl.src); } catch {}
      }
    } catch {}
    setDigestPlaying(false);
  }

  async function playArticleAudio(link?: string | null, id?: string) {
    if (!link) return;
    const key = id || link;
    // Si l'audio était prêt mais bloqué, retenter sans regénérer ni reconsommer
    if (preparedArticleId === key && audioEl) {
      try {
        setArticlePlayingId(key);
        audioEl.onended = () => setArticlePlayingId((cur) => (cur === key ? null : cur));
        await audioEl.play();
        setPreparedArticleId(null);
        toast.success(lang === "fr" ? "Lecture démarrée" : "Playback started");
        return;
      } catch {
        toast.error(lang === "fr" ? "Touchez à nouveau pour lire (autoplay bloqué)" : "Tap again to play (autoplay blocked)");
        return;
      }
    }
    // Consommer un token
    try { window.dispatchEvent(new Event("flux:ai:token:consume")); } catch {}
    setArticleGeneratingId(key);
    try {
      let apiKey = "";
      try { apiKey = localStorage.getItem("flux:ai:openai") || ""; } catch {}
      const voice = (localStorage.getItem("flux:ai:voice") as string) || "alloy";
      const res = await fetch("/api/ai/summarize-tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: link, lang, apiKey: apiKey || undefined, voice, mode: "audio", textOnly: false }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.audio) {
        if (res.status === 401) {
          try { setAiKeyInput(localStorage.getItem("flux:ai:openai") || ""); } catch { setAiKeyInput(""); }
          setAiKeyOpen(true);
        }
        toast.error((j?.error as string) || (lang === "fr" ? "Échec de génération audio" : "Audio generation failed"));
        return;
      }
      if (audioEl) { try { audioEl.pause(); } catch {} }
      const blob = base64ToBlob(j.audio as string, "audio/mpeg");
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      setAudioEl(audio);
      setArticlePlayingId(key);
      audio.onended = () => { setArticlePlayingId((cur) => (cur === key ? null : cur)); try { URL.revokeObjectURL(url); } catch {} };
      try {
        await audio.play();
        toast.success(lang === "fr" ? "Lecture démarrée" : "Playback started");
      } catch {
        // Laisser l'audio prêt et demander un second appui
        setArticlePlayingId((cur) => (cur === key ? null : cur));
        setPreparedArticleId(key);
        toast.error(lang === "fr" ? "Touchez à nouveau pour lire (autoplay bloqué)" : "Tap again to play (autoplay blocked)");
        return;
      }
    } catch (e) {
      console.error(e);
    } finally {
      setArticleGeneratingId((cur) => (cur === key ? null : cur));
    }
  }

  function stopArticleAudio(id?: string) {
    try {
      if (audioEl) {
        audioEl.pause();
        try { if (audioEl.src && audioEl.src.startsWith("blob:")) URL.revokeObjectURL(audioEl.src); } catch {}
      }
    } catch {}
    setArticlePlayingId((cur) => (id && cur !== id ? cur : null));
  }

  function proxyImage(url?: string | null): string | null {
    if (!url) return null;
    try {
      const key = btoa(url).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
      return `/api/proxy-image/${key}`;
    } catch {
      return null;
    }
  }

  function isYouTubeUrl(url?: string | null): boolean {
    if (!url) return false;
    try {
      const u = new URL(url);
      const h = u.hostname.replace(/^www\./, "");
      return h === "youtube.com" || h === "youtu.be" || h === "m.youtube.com" || h.endsWith("youtube-nocookie.com");
    } catch {
      return false;
    }
  }

  function getYouTubeEmbed(url?: string | null): string | null {
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
      params.set("autoplay", "0");
      params.set("playsinline", "1");
      params.set("rel", "0");
      params.set("modestbranding", "1");
      return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?${params.toString()}`;
    } catch {
      return null;
    }
  }

  const today = new Date();
  const weekday = format(today, "EEEE", { locale: lang === "fr" ? frLocale : enUS });
  const dateRest = format(today, "d MMMM yyyy", { locale: lang === "fr" ? frLocale : enUS });
  const dateTitle = `${weekday} ${dateRest}`;

  useEffect(() => {
    try {
      const ver = localStorage.getItem("flux:overview:ver");
      const saved = localStorage.getItem("flux:overview:today");
      if (ver === OVERVIEW_RENDER_VERSION && saved) {
        const j = JSON.parse(saved) as {
          html: string;
          date: string;
          items?: Array<{ title: string; link: string | null; image: string | null; summary: string; host: string; pubDate: string | null }>;
          intro?: string;
        };
        setContent({
          html: sanitizeOverviewHtml(j.html, lang, dateTitle),
          items: Array.isArray(j.items) ? j.items : undefined,
          intro: typeof j.intro === "string" ? j.intro : undefined,
        });
        if (j?.date) {
          const d = new Date(j.date);
          if (!isNaN(d.getTime())) setLastUpdated(d);
        }
      } else {
        // version périmée → purger le cache pour forcer un nouveau rendu
        try { localStorage.removeItem("flux:overview:today"); } catch {}
        try { localStorage.setItem("flux:overview:ver", OVERVIEW_RENDER_VERSION); } catch {}
      }
      const savedBg = localStorage.getItem("flux:overview:bg");
      if (savedBg) {
        const b = JSON.parse(savedBg) as { url?: string; q?: string };
        if (b?.url) setBgUrl(b.url);
        if (typeof b?.q === "string") setBgQuery(b.q);
      }
      const savedKey = localStorage.getItem("flux:unsplash:key");
      if (savedKey) setUnsplashKey(savedKey);
    } catch {}
  }, [lang, dateTitle]);

  async function requestOverview(fast: boolean, timeoutMs: number) {
    const startedAt = Date.now();
    let feeds: string[] = [];
    try {
      const str = localStorage.getItem("flux:feeds");
      if (str) {
        const arr = JSON.parse(str) as { url: string }[];
        feeds = arr.map((x) => x.url).filter(Boolean);
      }
    } catch {}
    let apiKey = "";
    try { apiKey = localStorage.getItem("flux:ai:openai") || ""; } catch {}
    const controller = new AbortController();
    const t: ReturnType<typeof setTimeout> = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch("/api/overview/today", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feeds, lang, apiKey: apiKey || undefined, fast, images: true, debug: true }),
      signal: controller.signal,
    });
    clearTimeout(t);
    console.log("[overview] request", { fast, status: res.status, ms: Date.now() - startedAt });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      throw new Error(j?.error || `HTTP ${res.status}`);
    }
    return (await res.json()) as {
      html: string;
      items?: Array<{ title: string; link: string | null; image: string | null; summary: string; host: string; pubDate: string | null }>;
      intro?: string;
      dbg?: unknown;
    };
  }

  const generate = useCallback(async () => {
    if (generatingRef.current) return;
    generatingRef.current = true;
    setGenerating(true);
    try {
      console.log("[overview] generate: start", { lang });
      // Tentative complète d'abord
      type OverviewItem = { title: string; link: string | null; image: string | null; summary: string; host: string; pubDate: string | null };
      let j: { html: string; items?: OverviewItem[]; intro?: string } | null = null;
      try {
        j = await requestOverview(false, 45000);
      } catch (e) {
        console.warn("[overview] full request failed, fallback to fast", e);
      }
      // Fallback rapide si échec/timeout
      if (!j) {
        try {
          j = await requestOverview(true, 15000);
        } catch (e) {
          console.error("[overview] fast request failed", e);
          throw e;
        }
        // Lancer enrichissement en arrière-plan pour remplacer ensuite
        (async () => {
          try {
            const full = await requestOverview(false, 45000);
            const cleanHtml2 = sanitizeOverviewHtml(full.html, lang, dateTitle);
            setContent({ html: cleanHtml2, items: full.items, intro: full.intro });
            try {
              localStorage.setItem("flux:overview:today", JSON.stringify({ html: cleanHtml2, items: full.items, intro: full.intro, date: new Date().toISOString() }));
              localStorage.setItem("flux:overview:ver", OVERVIEW_RENDER_VERSION);
              setLastUpdated(new Date());
            } catch {}
          } catch (e2) {
            console.warn("[overview] background enrich failed", e2);
          }
        })();
      }
      const cleanHtmlFinal = sanitizeOverviewHtml(j!.html, lang, dateTitle);
      setContent({ html: cleanHtmlFinal, items: j!.items, intro: j!.intro });
      try {
        localStorage.setItem("flux:overview:today", JSON.stringify({ html: cleanHtmlFinal, items: j!.items, intro: j!.intro, date: new Date().toISOString() }));
        localStorage.setItem("flux:overview:ver", OVERVIEW_RENDER_VERSION);
        setLastUpdated(new Date());
      } catch {}
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") {
        toast.error("Temps dépassé. Réessaie dans un instant.");
        console.warn("[overview] generate: abort", e);
      } else if (typeof e === "object" && e && "message" in e) {
        const messageVal = (e as { message?: unknown }).message;
        const msg = typeof messageVal === "string" ? messageVal : String(messageVal ?? "");
        if (msg.toLowerCase().includes("abort")) {
          toast.error("Temps dépassé. Réessaie dans un instant.");
          console.warn("[overview] generate: abort-msg", msg);
        } else {
          console.error(e);
          toast.error("Failed to generate");
        }
      } else {
        console.error(e);
        toast.error("Failed to generate");
      }
    } finally {
      generatingRef.current = false;
      setGenerating(false);
    }
  }, [lang, dateTitle, requestOverview]);
  // Plus de fallback source.unsplash (503). On n'utilise que l'API Unsplash via /api/unsplash/search

  async function searchUnsplash(nextPage?: number) {
    const q = (bgQuery || "nature").trim();
    setLoadingUnsplash(true);
    try {
      const controller = new AbortController();
      const t: ReturnType<typeof setTimeout> = setTimeout(() => controller.abort(), 25000);
      const res = await fetch("/api/unsplash/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q, key: unsplashKey || undefined, perPage: 12, page: nextPage || 1 }),
        signal: controller.signal,
      });
      clearTimeout(t);
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}) as unknown)) as { error?: string; status?: number; info?: unknown };
        const msg = typeof err?.error === "string" && err.error ? err.error : `HTTP ${res.status}`;
        throw new Error(msg);
      }
      const j = (await res.json()) as { results: Array<{ id: string; thumb: string | null; small: string | null; regular: string | null; full?: string | null }>; totalPages?: number; page?: number };
      const mapped = (j.results || []).map(r => ({ id: r.id, thumb: r.thumb || null, small: r.small || null, regular: r.regular || null, full: r.full || null }));
      const pageUsed = nextPage || 1;
      // Remplacer la grille par la nouvelle page (pas d'addition)
      setUnsplashResults(mapped);
      setUnsplashPage(pageUsed);
      setUnsplashHasMore((j.totalPages || 0) > pageUsed);
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : String(e);
      if (/Missing key/i.test(msg)) {
        toast.error(lang === "fr" ? "Clé Unsplash manquante côté serveur. Configurez UNSPLASH_ACCESS_KEY et relancez." : "Missing Unsplash key on server. Set UNSPLASH_ACCESS_KEY and restart.");
      } else if (/aborted/i.test(msg)) {
        toast.error(lang === "fr" ? "Recherche trop longue (timeout). Réessaie." : "Search timed out. Please retry.");
      } else {
        toast.error((lang === "fr" ? "Recherche Unsplash échouée: " : "Unsplash search failed: ") + msg);
      }
    } finally {
      setLoadingUnsplash(false);
    }
  }

  function saveUnsplashKey(k: string) {
    setUnsplashKey(k);
    try { localStorage.setItem("flux:unsplash:key", k); } catch {}
  }

  function applyBackground(url: string, q: string) {
    // Utiliser directement Unsplash (pas de proxy) pour éviter les 502
    setBgUrl(url);
    try {
      localStorage.setItem("flux:overview:bg", JSON.stringify({ url, q }));
    } catch {}
    setBgOpen(false);
  }

  function clearBackground() {
    setBgUrl(null);
    try {
      localStorage.removeItem("flux:overview:bg");
    } catch {}
  }


  // Rafraîchissement automatique toutes les 5 minutes, et au retour en visibilité
  useEffect(() => {
    const FIVE_MIN = 5 * 60 * 1000;

    const shouldRefreshNow = (): boolean => {
      try {
        const saved = localStorage.getItem("flux:overview:today");
        if (!saved) return true;
        const j = JSON.parse(saved) as { html?: string; date?: string };
        if (!j?.date) return true;
        const last = new Date(j.date).getTime();
        if (!Number.isFinite(last)) return true;
        return Date.now() - last >= FIVE_MIN;
      } catch {
        return true;
      }
    };

    const triggerIfNeeded = () => {
      if (document.visibilityState !== "visible") return;
      if (generatingRef.current) return;
      if (shouldRefreshNow()) {
        void generate();
      }
    };

    // Déclenchement initial si nécessaire
    triggerIfNeeded();

    // Rafraîchir lors d'un retour en visibilité
    const onVisibilityChange = () => triggerIfNeeded();
    document.addEventListener("visibilitychange", onVisibilityChange);

    // Intervalle régulier
    const intervalId = setInterval(() => {
      triggerIfNeeded();
    }, FIVE_MIN);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [lang, dateTitle]);

  // Déclencher une recherche auto à l'ouverture si une requête est présente (la clé peut venir du serveur)
  useEffect(() => {
    if (bgOpen && (bgQuery || "").trim()) {
      setUnsplashPage(1);
      void searchUnsplash(1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgOpen]);

  // Hook de luminance pour la carte "featured" (doit être appelé à top-level pour respecter les Rules of Hooks)
  const featuredImgForContrast = proxyImage(content?.items?.[0]?.image ?? null) || undefined;
  const { luminance: featuredLuminance, overlayCss: featuredOverlayCss } = useImageLuminance(featuredImgForContrast);

  // Compléter côté client les images manquantes (evite le budget côté serveur)
  useEffect(() => {
    if (!content?.items || fillingImagesRef.current) return;
    const missing = content.items.filter((it) => !it.image && it.link);
    if (!missing.length) return;
    fillingImagesRef.current = true;
    (async () => {
      try {
        const cap = Math.min(24, missing.length);
        const slice = missing.slice(0, cap);
        console.log("[overview] client-fill: start", { missing: missing.length, attempting: slice.length });
        const results = await Promise.allSettled(
          slice.map(async (it) => {
            try {
              const r = await fetch(`/api/og-image?u=${encodeURIComponent(it.link as string)}`);
              if (!r.ok) return null;
              const j = (await r.json()) as { image?: string | null };
              return { link: it.link, image: j?.image || null } as { link: string | null; image: string | null };
            } catch {
              return null;
            }
          })
        );
        const updates = new Map<string, string>();
        for (const res of results) {
          if (res.status === "fulfilled" && res.value && res.value.link && res.value.image) {
            updates.set(res.value.link, res.value.image);
          }
        }
        console.log("[overview] client-fill: done", { updated: updates.size });
        if (updates.size) {
          setContent((prev) => {
            if (!prev?.items) return prev;
            const nextItems = prev.items.map((it) =>
              !it.image && it.link && updates.has(it.link) ? { ...it, image: updates.get(it.link) || it.image } : it
            );
            try {
              localStorage.setItem(
                "flux:overview:today",
                JSON.stringify({ html: prev.html, items: nextItems, intro: prev.intro, date: new Date().toISOString() })
              );
            } catch {}
            return { ...prev, items: nextItems };
          });
        }
      } finally {
        fillingImagesRef.current = false;
      }
    })();
  }, [content?.items]);

  if (!content) {
    const updatedLabel = lastUpdated
      ? `${t(lang, "lastUpdatedLabel")}: ${format(lastUpdated, lang === "fr" ? "d MMM yyyy 'à' HH:mm" : "MMM d, yyyy 'at' p", { locale: lang === "fr" ? frLocale : enUS })}`
      : "";
    return (
      <div className="min-h-[60vh]">
        <div className="max-w-3xl mx-auto">
          <div className={`flex items-center ${isMobile ? "justify-start" : "justify-between"} gap-4`}>
          <div className="min-w-0">
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">
              <span className="first-letter:uppercase" style={{ color: "#FF5100" }}>{weekday}</span>{" "}
              <span className="first-letter:uppercase">{dateRest}</span>
            </h1>
            {updatedLabel ? (
              <p className="mt-1 text-xs text-muted-foreground">{updatedLabel}</p>
            ) : null}
          </div>
          {!isMobile && (
          <div className="flex items-center gap-2">
            <Dialog open={bgOpen} onOpenChange={setBgOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="icon" title={lang === "fr" ? "Arrière-plan" : "Background"}>
                  <ImageIcon className="w-4 h-4" />
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                  <DialogTitle>{lang === "fr" ? "Image d’arrière-plan" : "Background image"}</DialogTitle>
                  <DialogDescription>
                    {lang === "fr" ? "Saisis un mot-clé, cherche sur Unsplash et choisis une image." : "Enter a keyword, search Unsplash and pick an image."}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Input
                      value={bgQuery}
                      onChange={(e) => setBgQuery(e.target.value)}
                      placeholder={lang === "fr" ? "Mot-clé (ex: nature, ville)" : "Keyword (e.g. nature, city)"}
                    />
                    <Button variant="outline" onClick={() => void searchUnsplash(1)} disabled={loadingUnsplash} title={lang === "fr" ? "Rechercher" : "Search"}>
                      <RefreshCcw className={loadingUnsplash ? "w-4 h-4 animate-spin" : "w-4 h-4"} />
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      value={unsplashKey}
                      onChange={(e) => saveUnsplashKey(e.target.value)}
                      placeholder={lang === "fr" ? "Clé API Unsplash" : "Unsplash API key"}
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    {unsplashResults.length === 0 ? (
                      <div className="col-span-3 text-sm text-muted-foreground">
                        {lang === "fr" ? "Aucune image. Saisis une clé et lance une recherche." : "No images. Enter a key and run a search."}
                      </div>
                    ) : (
                      unsplashResults.map((r, i) => {
                        const u = r.thumb || r.small || r.regular || r.full || "";
                        return (
                          <button
                            key={r.id || i}
                            type="button"
                            onClick={() => applyBackground(r.regular || r.full || u, bgQuery)}
                            className="relative group overflow-hidden rounded-md border hover:ring-2 hover:ring-ring"
                            title={lang === "fr" ? "Choisir" : "Select"}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={u} alt="bg" className="w-full h-24 object-cover" />
                          </button>
                        );
                      })
                    )}
                  </div>
                  {unsplashHasMore ? (
                    <div className="mt-3 flex justify-center">
                      <Button variant="outline" onClick={() => void searchUnsplash(unsplashPage + 1)} disabled={loadingUnsplash}>
                        {loadingUnsplash ? (
                          <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> {lang === "fr" ? "Chargement…" : "Loading…"}</span>
                        ) : (
                          lang === "fr" ? "Charger plus" : "Load more"
                        )}
                      </Button>
                    </div>
                  ) : null}
                  {bgUrl ? (
                    <div className="flex items-center justify-between pt-2">
                      <span className="text-xs text-muted-foreground truncate max-w-[70%]">{bgQuery ? `“${bgQuery}”` : ""}</span>
                      <Button variant="destructive" size="icon" onClick={clearBackground} title={lang === "fr" ? "Supprimer" : "Remove"}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ) : null}
                </div>
              </DialogContent>
            </Dialog>
            <Button onClick={generate} disabled={generating}>
              {generating ? (
                <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> {t(lang, "generatingResume")}</span>
              ) : (
                t(lang, "generateTodayResume")
              )}
            </Button>
          </div>
          )}
          {isMobile ? (
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                className="inline-flex items-center justify-center h-8 w-8 rounded border hover:bg-foreground hover:text-background"
                aria-label={t(lang, "settingsTooltip")}
                onClick={() => {
                  try { window.dispatchEvent(new Event("flux:settings:open")); } catch {}
                }}
              >
                <Settings2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 text-xs px-2.5 py-1.5 rounded border hover:bg-foreground hover:text-background"
                onClick={() => {
                  try { setAiKeyInput(localStorage.getItem("flux:ai:openai") || ""); } catch { setAiKeyInput(""); }
                  setAiKeyOpen(true);
                }}
              >
                {lang === "fr" ? "Clé IA" : "AI Key"}
              </button>
              {!sessionEmail ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-2 text-xs px-2.5 py-1.5 rounded border hover:bg-foreground hover:text-background"
                  onClick={async () => {
                    try {
                      const res = await fetch("/api/auth/login", { method: "POST" });
                      const j = await res.json().catch(() => ({}));
                      if (j?.url) window.location.href = j.url as string;
                    } catch {}
                  }}
                >
                  <LogIn className="w-3.5 h-3.5" /> {lang === "fr" ? "Se connecter" : "Sign in"}
                </button>
              ) : null}
              {/* Boutons lecture IA retirés sur mobile */}
            </div>
          ) : null}
          </div>
        </div>
        {generating ? (
          <div className="max-w-3xl mx-auto mt-6 grid grid-cols-1 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-xl border p-4">
                <div className="h-4 w-2/3 bg-foreground/10 rounded mb-3 animate-pulse" />
                <div className="h-40 w-full bg-foreground/10 rounded mb-3 animate-pulse" />
                <div className="h-3 w-full bg-foreground/10 rounded mb-2 animate-pulse" />
                <div className="h-3 w-5/6 bg-foreground/10 rounded mb-2 animate-pulse" />
                <div className="h-8 w-32 bg-foreground/10 rounded-full animate-pulse" />
              </div>
            ))}
          </div>
        ) : null}
        {bgUrl ? (
          <style jsx global>{`
            #flux-main { position: relative; z-index: 0; }
            #flux-main::before {
              content: "";
              position: fixed;
              top: 0;
              left: var(--sidebar-w, 280px);
              right: 0;
              bottom: 0;
              background-image: linear-gradient(rgba(0,0,0,0.38), rgba(0,0,0,0.38)), url(${bgUrl});
              background-size: cover;
              background-position: center center;
              background-repeat: no-repeat;
              z-index: -1;
              pointer-events: none;
            }
          `}</style>
        ) : null}
      </div>
    );
  }

  // Rendu éditorial si items présents
  if (content?.items && content.items.length) {
    const items = content.items;
    // Exclure les vidéos YouTube des cartes et du focus
    const nonYoutubeItems = items.filter((it) => !isYouTubeUrl(it.link));
    const featured = nonYoutubeItems[0];
    const rest = nonYoutubeItems.slice(1);
    // Extraire jusqu'à 4 vidéos YouTube depuis la liste complète (en priorité dans rest)
    const youtubeEmbeds: string[] = [];
    for (const it of items) {
      if (youtubeEmbeds.length >= 4) break;
      if (isYouTubeUrl(it.link)) {
        const e = getYouTubeEmbed(it.link);
        if (e) youtubeEmbeds.push(e);
      }
    }
    const firstRow = rest.slice(0, 3);
    const secondRow = rest.slice(3, 6);
    const thirdRow = rest.slice(6, 9);
    const afterRows = rest.slice(9);
    const lastRowFocus = afterRows[0];
    const lastRowSide = afterRows[1];
    const remaining = afterRows.slice(2);
    return (
      <div className="max-w-5xl mx-auto px-3 sm:px-0">
        <div className={`flex items-center ${isMobile ? "justify-start" : "justify-between"} gap-4 not-prose mb-4`}>
          <div className="min-w-0">
            <h1 className="m-0 text-3xl md:text-4xl font-extrabold tracking-tight">
              <span className="first-letter:uppercase" style={{ color: "#FF5100" }}>{weekday}</span>{" "}
              <span className="first-letter:uppercase">{dateRest}</span>
            </h1>
            {lastUpdated ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {t(lang, "lastUpdatedLabel")}: {format(lastUpdated, lang === "fr" ? "d MMM yyyy 'à' HH:mm" : "MMM d, yyyy 'at' p", { locale: lang === "fr" ? frLocale : enUS })}
              </p>
            ) : null}
          </div>
          {!isMobile && (
          <div className="flex items-center gap-2">
            <Dialog open={bgOpen} onOpenChange={setBgOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="icon" title={lang === "fr" ? "Arrière-plan" : "Background"}>
                  <ImageIcon className="w-4 h-4" />
                </Button>
              </DialogTrigger>
              {/* Réutilisation du contenu de dialog existant (recherche Unsplash) */}
              <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                  <DialogTitle>{lang === "fr" ? "Image d’arrière-plan" : "Background image"}</DialogTitle>
                  <DialogDescription>
                    {lang === "fr" ? "Saisis un mot-clé, cherche sur Unsplash et choisis une image." : "Enter a keyword, search Unsplash and pick an image."}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Input value={bgQuery} onChange={(e) => setBgQuery(e.target.value)} placeholder={lang === "fr" ? "Mot-clé (ex: nature, ville)" : "Keyword (e.g. nature, city)"} />
                    <Button variant="outline" onClick={() => void searchUnsplash(1)} title={lang === "fr" ? "Rechercher" : "Search"}>
                      <RefreshCcw className={loadingUnsplash ? "w-4 h-4 animate-spin" : "w-4 h-4"} />
                    </Button>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    {unsplashResults.length === 0 ? (
                      <div className="col-span-3 text-sm text-muted-foreground">{lang === "fr" ? "Aucune image. Saisis une clé et lance une recherche." : "No images. Enter a key and run a search."}</div>
                    ) : (
                      unsplashResults.map((r, i) => {
                        const u = r.thumb || r.small || r.regular || r.full || "";
                        return (
                          <button key={r.id || i} type="button" onClick={() => applyBackground(r.regular || r.full || u, bgQuery)} className="relative group overflow-hidden rounded-md border hover:ring-2 hover:ring-ring" title={lang === "fr" ? "Choisir" : "Select"}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={u} alt="bg" className="w-full h-24 object-cover" />
                          </button>
                        );
                      })
                    )}
                  </div>
                  {unsplashHasMore ? (
                    <div className="mt-3 flex justify-center">
                      <Button variant="outline" onClick={() => void searchUnsplash(unsplashPage + 1)} disabled={loadingUnsplash}>
                        {loadingUnsplash ? (<span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> {lang === "fr" ? "Chargement…" : "Loading…"}</span>) : (lang === "fr" ? "Charger plus" : "Load more")}
                      </Button>
                    </div>
                  ) : null}
                  {bgUrl ? (
                    <div className="flex items-center justify-between pt-2">
                      <span className="text-xs text-muted-foreground truncate max-w-[70%]">{bgQuery ? `“${bgQuery}”` : ""}</span>
                      <Button variant="destructive" size="icon" onClick={clearBackground} title={lang === "fr" ? "Supprimer" : "Remove"}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ) : null}
                </div>
              </DialogContent>
            </Dialog>
            <Button onClick={generate} disabled={generating} variant="outline">
              {generating ? (<span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> {t(lang, "generatingResume")}</span>) : (t(lang, "updateResume"))}
            </Button>
          </div>
          )}
          {isMobile ? (
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                className="inline-flex items-center justify-center h-8 w-8 rounded border hover:bg-foreground hover:text-background"
                aria-label={t(lang, "settingsTooltip")}
                title={t(lang, "settingsTooltip")}
                onClick={() => { try { window.dispatchEvent(new Event("flux:settings:open")); } catch {} }}
              >
                <Settings2 className="w-4 h-4" />
              </button>
              {!sessionEmail ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-2 text-xs px-2.5 py-1.5 rounded border hover:bg-foreground hover:text-background"
                  onClick={async () => {
                    try {
                      const res = await fetch("/api/auth/login", { method: "POST" });
                      const j = await res.json().catch(() => ({}));
                      if (j?.url) window.location.href = j.url as string;
                    } catch {}
                  }}
                >
                  <LogIn className="w-3.5 h-3.5" /> {lang === "fr" ? "Se connecter" : "Sign in"}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Fond fixe pour la section overview comme avant */}
        {bgUrl ? (
          <style jsx global>{`
            #flux-main { position: relative; z-index: 0; }
            #flux-main::before {
              content: "";
              position: fixed;
              top: 0; left: var(--sidebar-w, 280px); right: 0; bottom: 0;
              background-image: linear-gradient(to top, rgba(0,0,0,1), rgba(0,0,0,0.6)), url(${bgUrl});
              background-size: cover; background-position: center center; background-repeat: no-repeat;
              z-index: -1; pointer-events: none;
            }
            :root.light #flux-main::before, .light #flux-main::before, [data-theme="light"] #flux-main::before, .theme-light #flux-main::before {
              background-image: linear-gradient(to top, rgba(255,255,255,1), rgba(255,255,255,0.6)), url(${bgUrl});
            }
          `}</style>
        ) : null}

        {/* Featured ou Skeleton pendant génération */}
        {generating ? (
          <div className="relative overflow-hidden border border-foreground/10 rounded-xl sm:h-[420px]">
            <Skeleton className="absolute inset-0 w-full h-full" />
          </div>
        ) : featured ? (
          <a href={featured.link || undefined} target="_blank" rel="noreferrer" className="block w-full">
            {(() => {
              const imgUrl = proxyImage(featured.image) || undefined;
              // Utiliser les valeurs calculées au top-level pour respecter les Rules of Hooks
              const lum = typeof featuredLuminance === "number" ? featuredLuminance : 0;
              const isBright = lum > 0.6;
              const textClass = isBright ? "text-black" : "text-white";
              const subTextClass = isBright ? "text-black/70" : "text-white/80";
              return (
                <div className="relative overflow-hidden border border-foreground/10 hover:border-foreground/30 transition-colors rounded-xl sm:h-[420px] group">
                  <div className="absolute inset-0 bg-muted" />
                  {imgUrl ? (
                    <img src={imgUrl} alt="" className="absolute inset-0 object-cover w-full h-full" loading="lazy" referrerPolicy="no-referrer" />
                  ) : null}
                  {featured.link ? (
                    <button
                      type="button"
                      className="absolute right-3 top-3 z-[4] rounded-full bg-black/60 text-white p-2 backdrop-blur-sm hover:bg-black/70 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                      title={t(lang, "copyLink")}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void copyLinkToClipboard(featured.link || undefined);
                      }}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M8 7a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-1a1 1 0 1 1 0-2h1a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v1a1 1 0 1 1-2 0V7z"/><path d="M4 11a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-6zm3-1a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H7z"/></svg>
                    </button>
                  ) : null}
                  {/* Blur progressif pour lisibilité */}
                  <div
                    className="absolute inset-x-0 bottom-0 h-[60%] backdrop-blur-2xl z-[1]"
                    style={{
                      WebkitMaskImage: "linear-gradient(to top, rgba(0,0,0,1) 0%, rgba(0,0,0,0.9) 25%, rgba(0,0,0,0) 70%)",
                      maskImage: "linear-gradient(to top, rgba(0,0,0,1) 0%, rgba(0,0,0,0.9) 25%, rgba(0,0,0,0) 70%)",
                    }}
                    aria-hidden="true"
                  />
                  {/* Overlay adaptatif selon luminance */}
                  <div className="absolute inset-0 z-[2]" style={{ background: featuredOverlayCss || "linear-gradient(to top, rgba(0,0,0,0.6), rgba(0,0,0,0))" }} aria-hidden="true" />
                  <div className="absolute inset-x-0 bottom-0 p-4 md:p-6 z-[3]">
                    <div className={`text-xs mb-2 ${subTextClass}`}>
                      {featured.pubDate ? format(new Date(featured.pubDate as string), "d MMM yyyy", { locale: lang === 'fr' ? frLocale : enUS }) : null}
                    </div>
                    <h2 className={`text-2xl md:text-3xl font-semibold leading-tight mb-2 ${textClass}`}>{featured.title}</h2>
                    {featured.summary ? (
                      <p className={`text-sm md:text-base max-w-3xl line-clamp-3 drop-shadow ${subTextClass}`}>{featured.summary}</p>
                    ) : null}
                  </div>
                </div>
              );
            })()}
          </a>
        ) : null}

        {/* 1ère ligne de 3 articles (ou skeleton) */}
        {generating ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="relative overflow-hidden border border-foreground/10 rounded-xl sm:h-[350px] flex flex-col">
                <Skeleton className="h-[200px] w-full" />
                <div className="px-3 py-2 space-y-2">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-4 w-[90%]" />
                  <Skeleton className="h-4 w-[70%]" />
                </div>
              </div>
            ))}
          </div>
        ) : firstRow.length ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
            {firstRow.map((it, idx) => (
              <a key={idx} href={it.link || undefined} target="_blank" rel="noreferrer" className="block h-full">
                <div className="relative overflow-hidden border border-foreground/10 hover:border-foreground/30 transition-colors rounded-xl sm:h-[350px] flex flex-col group">
                  <div className="relative h-[200px] bg-muted overflow-hidden group">
                    {proxyImage(it.image) ? (
                      <img src={proxyImage(it.image) as string} alt="" className="block object-cover w-full h-full" loading="lazy" referrerPolicy="no-referrer" />
                    ) : null}
                    {it.link ? (
                      <button
                        type="button"
                        className="absolute right-2 top-2 z-[4] rounded-full bg-black/60 text-white p-2 backdrop-blur-sm hover:bg-black/70 transition-opacity"
                        style={{ opacity: (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(hover: hover)').matches) ? 0 : 1 }}
                        title={t(lang, "copyLink")}
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); void copyLinkToClipboard(it.link); }}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M8 7a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-1a1 1 0 1 1 0-2h1a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v1a1 1 0 1 1-2 0V7z"/><path d="M4 11a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-6zm3-1a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H7z"/></svg>
                      </button>
                    ) : null}
                  </div>
                  <div className="px-3 py-2 space-y-1 flex-1 flex flex-col overflow-hidden">
                    <div className="text-xs text-muted-foreground">
                      {it.pubDate ? format(new Date(it.pubDate as string), "d MMM yyyy", { locale: lang === 'fr' ? frLocale : enUS }) : null}
                    </div>
                    <h3 className="font-medium leading-snug line-clamp-2 pb-px">{it.title}</h3>
                    {it.summary ? (<p className="text-[13px] leading-snug text-muted-foreground line-clamp-3">{it.summary}</p>) : null}
                  </div>
                  {/* Contrôles lecture IA retirés sur mobile */}
                </div>
              </a>
            ))}
          </div>
        ) : null}

        {/* 1ère vidéo intercalée */}
        {generating ? (
          <div className="mt-6">
            <div className="relative w-full pt-[56.25%] rounded-xl overflow-hidden border border-foreground/10">
              <Skeleton className="absolute inset-0 w-full h-full" />
            </div>
          </div>
        ) : youtubeEmbeds[0] ? (
          <div className="mt-6">
            <div className="relative w-full pt-[56.25%] rounded-xl overflow-hidden border border-foreground/10">
              <iframe
                src={youtubeEmbeds[0]}
                className="absolute inset-0 w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            </div>
          </div>
        ) : null}

        {/* 2ème ligne de 3 articles (ou skeleton) */}
        {generating ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="relative overflow-hidden border border-foreground/10 rounded-xl sm:h-[350px] flex flex-col">
                <Skeleton className="h-[200px] w-full" />
                <div className="px-3 py-2 space-y-2">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-4 w-[90%]" />
                  <Skeleton className="h-4 w-[70%]" />
                </div>
              </div>
            ))}
          </div>
        ) : secondRow.length ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
            {secondRow.map((it, idx) => (
              <a key={idx} href={it.link || undefined} target="_blank" rel="noreferrer" className="block h-full">
                <div className="relative overflow-hidden border border-foreground/10 hover:border-foreground/30 transition-colors rounded-xl sm:h-[350px] flex flex-col group">
                  <div className="relative h-[200px] bg-muted overflow-hidden group">
                    {proxyImage(it.image) ? (
                      <img src={proxyImage(it.image) as string} alt="" className="block object-cover w-full h-full" loading="lazy" referrerPolicy="no-referrer" />
                    ) : null}
                    {it.link ? (
                      <button
                        type="button"
                        className="absolute right-2 top-2 z-[4] rounded-full bg-black/60 text-white p-2 backdrop-blur-sm hover:bg-black/70 transition-opacity"
                        style={{ opacity: (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(hover: hover)').matches) ? 0 : 1 }}
                        title={t(lang, "copyLink")}
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); void copyLinkToClipboard(it.link); }}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M8 7a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-1a1 1 0 1 1 0-2h1a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v1a1 1 0 1 1-2 0V7z"/><path d="M4 11a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-6zm3-1a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H7z"/></svg>
                      </button>
                    ) : null}
                  </div>
                  <div className="px-3 py-2 space-y-1 flex-1 flex flex-col overflow-hidden">
                    <div className="text-xs text-muted-foreground">
                      {it.pubDate ? format(new Date(it.pubDate as string), "d MMM yyyy", { locale: lang === 'fr' ? frLocale : enUS }) : null}
                    </div>
                    <h3 className="font-medium leading-snug line-clamp-2 pb-px">{it.title}</h3>
                    {it.summary ? (<p className="text-[13px] leading-snug text-muted-foreground line-clamp-3">{it.summary}</p>) : null}
                  </div>
                  {/* Contrôles lecture IA retirés sur mobile */}
                </div>
              </a>
            ))}
          </div>
        ) : null}

        {/* 2ème vidéo intercalée */}
        {generating ? (
          <div className="mt-6">
            <div className="relative w-full pt-[56.25%] rounded-xl overflow-hidden border border-foreground/10">
              <Skeleton className="absolute inset-0 w-full h-full" />
            </div>
          </div>
        ) : youtubeEmbeds[1] ? (
          <div className="mt-6">
            <div className="relative w-full pt-[56.25%] rounded-xl overflow-hidden border border-foreground/10">
              <iframe
                src={youtubeEmbeds[1]}
                className="absolute inset-0 w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            </div>
          </div>
        ) : null}

        {/* 3ème ligne de 3 articles (ou skeleton) */}
        {generating ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="relative overflow-hidden border border-foreground/10 rounded-xl sm:h-[350px] flex flex-col">
                <Skeleton className="h-[200px] w-full" />
                <div className="px-3 py-2 space-y-2">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-4 w-[90%]" />
                  <Skeleton className="h-4 w-[70%]" />
                </div>
              </div>
            ))}
          </div>
        ) : thirdRow.length ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
            {thirdRow.map((it, idx) => (
              <a key={idx} href={it.link || undefined} target="_blank" rel="noreferrer" className="block h-full">
                <div className="relative overflow-hidden border border-foreground/10 hover:border-foreground/30 transition-colors rounded-xl sm:h-[350px] flex flex-col group">
                  <div className="relative h-[200px] bg-muted overflow-hidden group">
                    {proxyImage(it.image) ? (
                      <img src={proxyImage(it.image) as string} alt="" className="block object-cover w-full h-full" loading="lazy" referrerPolicy="no-referrer" />
                    ) : null}
                    {it.link ? (
                      <button
                        type="button"
                        className="absolute right-2 top-2 z-[4] rounded-full bg-black/60 text-white p-2 backdrop-blur-sm hover:bg-black/70 transition-opacity"
                        style={{ opacity: (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(hover: hover)').matches) ? 0 : 1 }}
                        title={t(lang, "copyLink")}
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); void copyLinkToClipboard(it.link); }}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M8 7a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-1a1 1 0 1 1 0-2h1a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v1a1 1 0 1 1-2 0V7z"/><path d="M4 11a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-6zm3-1a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H7z"/></svg>
                      </button>
                    ) : null}
                  </div>
                  <div className="px-3 py-2 space-y-1 flex-1 flex flex-col overflow-hidden">
                    <div className="text-xs text-muted-foreground">
                      {it.pubDate ? format(new Date(it.pubDate as string), "d MMM yyyy", { locale: lang === 'fr' ? frLocale : enUS }) : null}
                    </div>
                    <h3 className="font-medium leading-snug line-clamp-2 pb-px">{it.title}</h3>
                    {it.summary ? (<p className="text-[13px] leading-snug text-muted-foreground line-clamp-3">{it.summary}</p>) : null}
                  </div>
                </div>
              </a>
            ))}
          </div>
        ) : null}

        {/* Dernière ligne: 1 focus large (2 colonnes) + 1 carte normale */}
        {(lastRowFocus || lastRowSide) ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
            {lastRowFocus ? (
              <a href={lastRowFocus.link || undefined} target="_blank" rel="noreferrer" className="block h-full lg:col-span-2">
                <div className="relative overflow-hidden border border-foreground/10 hover:border-foreground/30 transition-colors rounded-xl sm:h-[350px] group">
                  <div className="absolute inset-0 bg-muted" />
                  {proxyImage(lastRowFocus.image) ? (
                    <img src={proxyImage(lastRowFocus.image) as string} alt="" className="absolute inset-0 object-cover w-full h-full" loading="lazy" referrerPolicy="no-referrer" />
                  ) : null}
                  {lastRowFocus.link ? (
                    <button
                      type="button"
                      className="absolute right-3 top-3 z-[3] rounded-full bg-black/60 text-white p-2 backdrop-blur-sm hover:bg-black/70 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                      title={t(lang, "copyLink")}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); void copyLinkToClipboard(lastRowFocus.link || undefined); }}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M8 7a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-1a1 1 0 1 1 0-2h1a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v1a1 1 0 1 1-2 0V7z"/><path d="M4 11a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-6zm3-1a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H7z"/></svg>
                    </button>
                  ) : null}
                  <div
                    className="absolute inset-x-0 bottom-0 h-[60%] backdrop-blur-2xl z-[1]"
                    style={{
                      WebkitMaskImage: "linear-gradient(to top, rgba(0,0,0,1) 0%, rgba(0,0,0,0.9) 25%, rgba(0,0,0,0) 70%)",
                      maskImage: "linear-gradient(to top, rgba(0,0,0,1) 0%, rgba(0,0,0,0.9) 25%, rgba(0,0,0,0) 70%)",
                    }}
                    aria-hidden="true"
                  />
                  <div className="absolute inset-0 z-[0]" aria-hidden="true" />
                  <div className="absolute inset-x-0 bottom-0 p-4 md:p-6 z-[2]">
                    <div className="text-xs mb-2 text-white/80 drop-shadow">
                      {lastRowFocus.pubDate ? format(new Date(lastRowFocus.pubDate as string), "d MMM yyyy", { locale: lang === 'fr' ? frLocale : enUS }) : null}
                    </div>
                    <h3 className="text-2xl md:text-3xl font-semibold leading-tight mb-2 text-white drop-shadow">{lastRowFocus.title}</h3>
                    {lastRowFocus.summary ? (
                      <p className="text-sm md:text-base max-w-3xl line-clamp-3 text-white/80 drop-shadow">{lastRowFocus.summary}</p>
                    ) : null}
                  </div>
                </div>
              </a>
            ) : null}
            {lastRowSide ? (
              <a href={lastRowSide.link || undefined} target="_blank" rel="noreferrer" className="block h-full">
                <div className="relative overflow-hidden border border-foreground/10 hover:border-foreground/30 transition-colors rounded-xl sm:h-[350px] flex flex-col group">
                  <div className="relative h-[200px] bg-muted overflow-hidden group">
                    {proxyImage(lastRowSide.image) ? (
                      <img src={proxyImage(lastRowSide.image) as string} alt="" className="block object-cover w-full h-full" loading="lazy" referrerPolicy="no-referrer" />
                    ) : null}
                    {lastRowSide.link ? (
                      <button
                        type="button"
                        className="absolute right-2 top-2 z-[4] rounded-full bg-black/60 text-white p-2 backdrop-blur-sm hover:bg-black/70 transition-opacity"
                        style={{ opacity: (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(hover: hover)').matches) ? 0 : 1 }}
                        title={t(lang, "copyLink")}
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); void copyLinkToClipboard(lastRowSide.link); }}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M8 7a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-1a1 1 0 1 1 0-2h1a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v1a1 1 0 1 1-2 0V7z"/><path d="M4 11a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-6zm3-1a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H7z"/></svg>
                      </button>
                    ) : null}
                  </div>
                  <div className="px-3 py-2 space-y-1 flex-1 flex flex-col overflow-hidden">
                    <div className="text-xs text-muted-foreground">
                      {lastRowSide.pubDate ? format(new Date(lastRowSide.pubDate as string), "d MMM yyyy", { locale: lang === 'fr' ? frLocale : enUS }) : null}
                    </div>
                    <h3 className="font-medium leading-snug line-clamp-2 pb-px">{lastRowSide.title}</h3>
                    {lastRowSide.summary ? (<p className="text-[13px] leading-snug text-muted-foreground line-clamp-3">{lastRowSide.summary}</p>) : null}
                  </div>
                </div>
              </a>
            ) : null}
          </div>
        ) : null}

        {/* 3ème vidéo intercalée */}
        {generating ? (
          <div className="mt-6">
            <div className="relative w-full pt-[56.25%] rounded-xl overflow-hidden border border-foreground/10">
              <Skeleton className="absolute inset-0 w-full h-full" />
            </div>
          </div>
        ) : youtubeEmbeds[2] ? (
          <div className="mt-6">
            <div className="relative w-full pt-[56.25%] rounded-xl overflow-hidden border border-foreground/10">
              <iframe
                src={youtubeEmbeds[2]}
                className="absolute inset-0 w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            </div>
          </div>
        ) : null}

        {/* 4ème vidéo intercalée */}
        {generating ? (
          <div className="mt-6">
            <div className="relative w-full pt-[56.25%] rounded-xl overflow-hidden border border-foreground/10">
              <Skeleton className="absolute inset-0 w-full h-full" />
            </div>
          </div>
        ) : youtubeEmbeds[3] ? (
          <div className="mt-6">
            <div className="relative w-full pt-[56.25%] rounded-xl overflow-hidden border border-foreground/10">
              <iframe
                src={youtubeEmbeds[3]}
                className="absolute inset-0 w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            </div>
          </div>
        ) : null}

        {/* Le reste des articles */}
          {remaining.length ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
            {remaining.map((it, idx) => (
              <a key={idx} href={it.link || undefined} target="_blank" rel="noreferrer" className="block h-full">
                <div className="relative overflow-hidden border border-foreground/10 hover:border-foreground/30 transition-colors rounded-xl sm:h-[350px] flex flex-col group">
                  <div className="relative h-[200px] bg-muted overflow-hidden group">
                    {proxyImage(it.image) ? (
                      <img src={proxyImage(it.image) as string} alt="" className="block object-cover w-full h-full" loading="lazy" referrerPolicy="no-referrer" />
                    ) : null}
                    {it.link ? (
                      <button
                        type="button"
                        className="absolute right-2 top-2 z-[4] rounded-full bg-black/60 text-white p-2 backdrop-blur-sm hover:bg-black/70 transition-opacity"
                        style={{ opacity: (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(hover: hover)').matches) ? 0 : 1 }}
                        title={t(lang, "copyLink")}
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); void copyLinkToClipboard(it.link); }}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M8 7a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-1a1 1 0 1 1 0-2h1a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v1a1 1 0 1 1-2 0V7z"/><path d="M4 11a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-6zm3-1a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H7z"/></svg>
                      </button>
                    ) : null}
                  </div>
                  <div className="px-3 py-2 space-y-1 flex-1 flex flex-col overflow-hidden">
                    <div className="text-xs text-muted-foreground">
                      {it.pubDate ? format(new Date(it.pubDate as string), "d MMM yyyy", { locale: lang === 'fr' ? frLocale : enUS }) : null}
                    </div>
                    <h3 className="font-medium leading-snug line-clamp-2 pb-px">{it.title}</h3>
                    {it.summary ? (<p className="text-[13px] leading-snug text-muted-foreground line-clamp-3">{it.summary}</p>) : null}
                  </div>
                  {/* Contrôles lecture IA retirés sur mobile */}
                </div>
              </a>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <article className="prose prose-sm sm:prose-base md:prose-lg dark:prose-invert max-w-3xl mx-auto px-3 sm:px-0 leading-relaxed">
      <div className={`flex items-center ${isMobile ? "justify-start" : "justify-between"} gap-4 not-prose mb-2`}>
        <div className="min-w-0">
          <h1 className="m-0 text-3xl md:text-4xl font-extrabold tracking-tight">
            <span className="first-letter:uppercase" style={{ color: "#FF5100" }}>{weekday}</span>{" "}
            <span className="first-letter:uppercase">{dateRest}</span>
          </h1>
          {lastUpdated ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {t(lang, "lastUpdatedLabel")}: {format(lastUpdated, lang === "fr" ? "d MMM yyyy 'à' HH:mm" : "MMM d, yyyy 'at' p", { locale: lang === "fr" ? frLocale : enUS })}
            </p>
          ) : null}
        </div>
        {!isMobile && (
        <div className="flex items-center gap-2">
          <Dialog open={bgOpen} onOpenChange={setBgOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="icon" title={lang === "fr" ? "Arrière-plan" : "Background"}>
                <ImageIcon className="w-4 h-4" />
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>{lang === "fr" ? "Image d’arrière-plan" : "Background image"}</DialogTitle>
                <DialogDescription>
                  {lang === "fr" ? "Saisis un mot-clé, cherche sur Unsplash et choisis une image." : "Enter a keyword, search Unsplash and pick an image."}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Input
                    value={bgQuery}
                    onChange={(e) => setBgQuery(e.target.value)}
                    placeholder={lang === "fr" ? "Mot-clé (ex: nature, ville)" : "Keyword (e.g. nature, city)"}
                  />
                  <Button variant="outline" onClick={() => void searchUnsplash(1)} title={lang === "fr" ? "Rechercher" : "Search"}>
                    <RefreshCcw className={loadingUnsplash ? "w-4 h-4 animate-spin" : "w-4 h-4"} />
                  </Button>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  {unsplashResults.length === 0 ? (
                    <div className="col-span-3 text-sm text-muted-foreground">
                      {lang === "fr" ? "Aucune image. Saisis une clé et lance une recherche." : "No images. Enter a key and run a search."}
                    </div>
                  ) : (
                    unsplashResults.map((r, i) => {
                      const u = r.thumb || r.small || r.regular || r.full || "";
                      return (
                        <button
                          key={r.id || i}
                          type="button"
                          onClick={() => applyBackground(r.regular || r.full || u, bgQuery)}
                          className="relative group overflow-hidden rounded-md border hover:ring-2 hover:ring-ring"
                          title={lang === "fr" ? "Choisir" : "Select"}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={u} alt="bg" className="w-full h-24 object-cover" />
                        </button>
                      );
                    })
                  )}
                </div>
                {unsplashHasMore ? (
                  <div className="mt-3 flex justify-center">
                    <Button variant="outline" onClick={() => void searchUnsplash(unsplashPage + 1)} disabled={loadingUnsplash}>
                      {loadingUnsplash ? (
                        <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> {lang === "fr" ? "Chargement…" : "Loading…"}</span>
                      ) : (
                        lang === "fr" ? "Charger plus" : "Load more"
                      )}
                    </Button>
                  </div>
                ) : null}
                {bgUrl ? (
                  <div className="flex items-center justify-between pt-2">
                    <span className="text-xs text-muted-foreground truncate max-w-[70%]">{bgQuery ? `“${bgQuery}”` : ""}</span>
                    <Button variant="destructive" size="icon" onClick={clearBackground} title={lang === "fr" ? "Supprimer" : "Remove"}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ) : null}
              </div>
            </DialogContent>
          </Dialog>
          <Button onClick={generate} disabled={generating} variant="outline">
            {generating ? (
              <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> {t(lang, "generatingResume")}</span>
            ) : (
              t(lang, "updateResume")
            )}
          </Button>
        </div>
        )}
        {isMobile ? (
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center justify-center h-8 w-8 rounded border hover:bg-foreground hover:text-background"
              aria-label={t(lang, "settingsTooltip")}
              title={t(lang, "settingsTooltip")}
              onClick={() => {
                try { window.dispatchEvent(new Event("flux:settings:open")); } catch {}
              }}
            >
              <Settings2 className="w-4 h-4" />
            </button>
            {!sessionEmail ? (
              <button
                type="button"
                className="inline-flex items-center gap-2 text-xs px-2.5 py-1.5 rounded border hover:bg-foreground hover:text-background"
                onClick={async () => {
                  try {
                    const res = await fetch("/api/auth/login", { method: "POST" });
                    const j = await res.json().catch(() => ({}));
                    if (j?.url) window.location.href = j.url as string;
                  } catch {}
                }}
              >
                <LogIn className="w-3.5 h-3.5" /> {lang === "fr" ? "Se connecter" : "Sign in"}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="[&_img]:w-full [&_img]:h-auto [&_img]:rounded-lg [&_img]:object-cover [&_table]:w-full [&_table]:block [&_table]:overflow-x-auto" dangerouslySetInnerHTML={{ __html: content.html }} />
      {(() => {
        // Fallback: extraire des vidéos YouTube même si items est absent
        try {
          const embeds: string[] = [];
          const wrapper = document.createElement("div");
          wrapper.innerHTML = content.html || "";
          const links = Array.from(wrapper.querySelectorAll("a[href]")) as HTMLAnchorElement[];
          for (const a of links) {
            if (embeds.length >= 4) break;
            const href = a.getAttribute("href") || "";
            if (isYouTubeUrl(href)) {
              const e = getYouTubeEmbed(href);
              if (e) embeds.push(e);
            }
          }
          if (!embeds.length) return null;
          return (
            <div className="not-prose">
              {embeds.slice(0, 4).map((src, i) => (
                <div key={i} className="mt-6">
                  <div className="relative w-full pt-[56.25%] rounded-xl overflow-hidden border border-foreground/10">
                    <iframe src={src} className="absolute inset-0 w-full h-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen />
                  </div>
                </div>
              ))}
            </div>
          );
        } catch {
          return null;
        }
      })()}
      {/* Fond fixe appliqué derrière la zone p-6 (overview) en couvrant la fenêtre */}
      {bgUrl ? (
        <style jsx global>{`
          #flux-main { position: relative; z-index: 0; }
          #flux-main::before {
            content: "";
            position: fixed;
            top: 0;
            left: var(--sidebar-w, 280px);
            right: 0;
            bottom: 0;
            background-image: linear-gradient(to top, rgba(0,0,0,1), rgba(0,0,0,0.6)), url(${bgUrl});
            background-size: cover;
            background-position: center center;
            background-repeat: no-repeat;
            z-index: -1;
            pointer-events: none;
          }
          /* Variante claire (dégradé clair) */
          :root.light #flux-main::before, .light #flux-main::before, [data-theme="light"] #flux-main::before, .theme-light #flux-main::before {
            background-image: linear-gradient(to top, rgba(255,255,255,1), rgba(255,255,255,0.6)), url(${bgUrl});
          }
        `}</style>
      ) : null}
      {/* Dialog clé OpenAI (mobile) */}
      <AiKeyDialog
        open={aiKeyOpen}
        onOpenChange={(o) => setAiKeyOpen(o)}
        value={aiKeyInput}
        onChange={(v) => setAiKeyInput(v)}
        onSave={() => {
          try { localStorage.setItem("flux:ai:openai", (aiKeyInput || "").trim()); } catch {}
          setAiKeyOpen(false);
          toast.success(lang === "fr" ? "Clé OpenAI enregistrée" : "OpenAI key saved");
        }}
        lang={lang}
      />
    </article>
  );
}

// Petit dialogue pour saisir/mettre à jour la clé OpenAI côté mobile
function AiKeyDialog({ open, onOpenChange, value, onChange, onSave, lang }: { open: boolean; onOpenChange: (o: boolean) => void; value: string; onChange: (v: string) => void; onSave: () => void; lang: string }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{lang === "fr" ? "Clé OpenAI" : "OpenAI Key"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            type="password"
            placeholder="sk-..."
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
          <div className="text-xs text-muted-foreground">
            {lang === "fr" ? "La clé reste stockée localement sur votre appareil et n'est jamais envoyée au serveur." : "The key is stored locally on your device and never sent to the server."}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>{lang === "fr" ? "Annuler" : "Cancel"}</Button>
            <Button onClick={onSave}>{lang === "fr" ? "Enregistrer" : "Save"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function base64ToBlob(base64: string, type = "application/octet-stream"): Blob {
  try {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes.buffer], { type });
  } catch {
    return new Blob([], { type });
  }
}

function sanitizeOverviewHtml(html: string, lang: string, dateTitle: string): string {
  try {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html || "";
    const first = wrapper.firstElementChild as HTMLElement | null;
    if (first && /H1|H2/i.test(first.tagName)) {
      const txt = (first.textContent || "").trim().toLowerCase();
      const dateTxt = dateTitle.trim().toLowerCase();
      const todayTxt = lang === "en" ? "today" : "aujourd"; // match "aujourd'hui"
      if (txt === dateTxt || txt.includes(todayTxt)) {
        wrapper.removeChild(first);
      }
    }
    return wrapper.innerHTML;
  } catch {
    return html;
  }
}


// Détection de luminance de l'image + overlay adaptatif (copie du hook utilisé dans FeedGrid)
function useImageLuminance(imageUrl?: string | null) {
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
          const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          sum += L;
        }
        const avg = sum / (w * h);
        if (!cancelled) {
          setLuminance(avg);
          const base = avg > 0.6 ? 0.35 : 0.6; // moins d'overlay si image claire
          setOverlayCss(
            `linear-gradient(to top, rgba(0,0,0,${base}) 0%, rgba(0,0,0,${Math.max(0, base - 0.25)}) 40%, rgba(0,0,0,0) 75%)`
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


