"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useLang, t } from "@/lib/i18n";
import { format } from "date-fns";
import { fr as frLocale, enUS } from "date-fns/locale";
import { toast } from "sonner";

export function Overview() {
  const [lang] = useLang();
  const [generating, setGenerating] = useState(false);
  const [content, setContent] = useState<null | { html: string }>(null);
  const generatingRef = useRef(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

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

  if (!content) {
    const updatedLabel = lastUpdated
      ? `${t(lang, "lastUpdatedLabel")}: ${format(lastUpdated, lang === "fr" ? "d MMM yyyy 'à' HH:mm" : "MMM d, yyyy 'at' p", { locale: lang === "fr" ? frLocale : enUS })}`
      : "";
    return (
      <div className="min-h-[60vh]">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">
              <span className="text-red-500 first-letter:uppercase">{weekday}</span>{" "}
              <span className="first-letter:uppercase">{dateRest}</span>
            </h1>
            {updatedLabel ? (
              <p className="mt-1 text-xs text-muted-foreground">{updatedLabel}</p>
            ) : null}
          </div>
          <Button onClick={generate} disabled={generating}>
            {generating ? (
              <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> {t(lang, "generatingResume")}</span>
            ) : (
              t(lang, "generateTodayResume")
            )}
          </Button>
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
        <Button onClick={generate} disabled={generating} variant="outline">
          {generating ? (
            <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> {t(lang, "generatingResume")}</span>
          ) : (
            t(lang, "updateResume")
          )}
        </Button>
      </div>
      <div className="[&_img]:w-full [&_img]:h-auto [&_img]:rounded-lg [&_img]:object-cover [&_table]:w-full [&_table]:block [&_table]:overflow-x-auto" dangerouslySetInnerHTML={{ __html: content.html }} />
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


