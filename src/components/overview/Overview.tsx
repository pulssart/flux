"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Image as ImageIcon, RefreshCcw, Trash2 } from "lucide-react";
import { useLang, t } from "@/lib/i18n";
import { format } from "date-fns";
import { fr as frLocale, enUS } from "date-fns/locale";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function Overview() {
  const [lang] = useLang();
  const [generating, setGenerating] = useState(false);
  const [content, setContent] = useState<null | { html: string }>(null);
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

  const today = new Date();
  const weekday = format(today, "EEEE", { locale: lang === "fr" ? frLocale : enUS });
  const dateRest = format(today, "d MMMM yyyy", { locale: lang === "fr" ? frLocale : enUS });
  const dateTitle = `${weekday} ${dateRest}`;

  useEffect(() => {
    try {
      const saved = localStorage.getItem("flux:overview:today");
      if (saved) {
        const j = JSON.parse(saved) as { html: string; date: string };
        setContent({ html: sanitizeOverviewHtml(j.html, lang, dateTitle) });
        if (j?.date) {
          const d = new Date(j.date);
          if (!isNaN(d.getTime())) setLastUpdated(d);
        }
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

  async function generate() {
    if (generatingRef.current) return;
    generatingRef.current = true;
    setGenerating(true);
    try {
      // Récupérer la liste des feeds côté client et l'envoyer au backend
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
      const t: ReturnType<typeof setTimeout> = setTimeout(() => controller.abort(), 20000);
      const res = await fetch("/api/overview/today", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feeds, lang, apiKey: apiKey || undefined, fast: true, images: true }),
        signal: controller.signal,
      });
      clearTimeout(t);
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      const j = (await res.json()) as { html: string };
      const cleanHtml = sanitizeOverviewHtml(j.html, lang, dateTitle);
      setContent({ html: cleanHtml });
      try {
        localStorage.setItem(
          "flux:overview:today",
          JSON.stringify({ html: cleanHtml, date: new Date().toISOString() })
        );
        setLastUpdated(new Date());
      } catch {}
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") {
        toast.error("Temps dépassé. Réessaie dans un instant.");
      } else if (typeof e === "object" && e && "message" in e) {
        const messageVal = (e as { message?: unknown }).message;
        const msg = typeof messageVal === "string" ? messageVal : String(messageVal ?? "");
        if (msg.toLowerCase().includes("abort")) {
          toast.error("Temps dépassé. Réessaie dans un instant.");
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
  }
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


  // Rafraîchissement automatique toutes les 15 minutes, et au retour en visibilité
  useEffect(() => {
    const FIFTEEN_MIN = 15 * 60 * 1000;

    const shouldRefreshNow = (): boolean => {
      try {
        const saved = localStorage.getItem("flux:overview:today");
        if (!saved) return true;
        const j = JSON.parse(saved) as { html?: string; date?: string };
        if (!j?.date) return true;
        const last = new Date(j.date).getTime();
        if (!Number.isFinite(last)) return true;
        return Date.now() - last >= FIFTEEN_MIN;
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
    }, FIFTEEN_MIN);

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

  if (!content) {
    const updatedLabel = lastUpdated
      ? `${t(lang, "lastUpdatedLabel")}: ${format(lastUpdated, lang === "fr" ? "d MMM yyyy 'à' HH:mm" : "MMM d, yyyy 'at' p", { locale: lang === "fr" ? frLocale : enUS })}`
      : "";
    return (
      <div className="min-h-[60vh]">
        <div className="max-w-3xl mx-auto">
          <div className={`flex items-center justify-between gap-4`}>
          <div>
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">
              <span className="text-red-500 first-letter:uppercase">{weekday}</span>{" "}
              <span className="first-letter:uppercase">{dateRest}</span>
            </h1>
            {updatedLabel ? (
              <p className="mt-1 text-xs text-muted-foreground">{updatedLabel}</p>
            ) : null}
          </div>
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

  return (
    <article className="prose prose-sm sm:prose-base md:prose-lg dark:prose-invert max-w-3xl mx-auto px-3 sm:px-0 leading-relaxed">
      <div className="flex items-center justify-between gap-4 not-prose mb-2">
        <div>
          <h1 className="m-0 text-3xl md:text-4xl font-extrabold tracking-tight">
            <span className="text-red-500 first-letter:uppercase">{weekday}</span>{" "}
            <span className="first-letter:uppercase">{dateRest}</span>
          </h1>
          {lastUpdated ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {t(lang, "lastUpdatedLabel")}: {format(lastUpdated, lang === "fr" ? "d MMM yyyy 'à' HH:mm" : "MMM d, yyyy 'at' p", { locale: lang === "fr" ? frLocale : enUS })}
            </p>
          ) : null}
        </div>
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
      </div>
      <div className="[&_img]:w-full [&_img]:h-auto [&_img]:rounded-lg [&_img]:object-cover [&_table]:w-full [&_table]:block [&_table]:overflow-x-auto" dangerouslySetInnerHTML={{ __html: content.html }} />
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
    </article>
  );
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


