"use client";

import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useLang, t } from "@/lib/i18n";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { useTheme } from "next-themes";
import { toast } from "sonner";

type ReaderModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  article: { title: string; link?: string; pubDate?: string; image?: string } | null;
};

export function ReaderModal({ open, onOpenChange, article }: ReaderModalProps) {
  const [lang] = useLang();
  const { resolvedTheme } = useTheme();
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<string>("");
  const [dateStr, setDateStr] = useState<string>("");
  const imageUrl = article?.image || undefined;
  const [loadingStep, setLoadingStep] = useState<number>(0);
  const [xOpen, setXOpen] = useState(false);
  const [xLoading, setXLoading] = useState(false);
  const [xText, setXText] = useState("");
  const [xStyle, setXStyle] = useState<string>("casual");

  function tryConsumeToken(): boolean {
    try {
      const key = "flux:ai:tokens";
      const today = new Date().toISOString().slice(0, 10);
      const raw = localStorage.getItem(key);
      let left = 30;
      const date = today;
      if (raw) {
        const j = JSON.parse(raw) as { date?: string; left?: number };
        if (j && j.date === today && typeof j.left === "number") {
          left = Math.max(0, j.left);
        }
      }
      if (left <= 0) return false;
      left = left - 1;
      localStorage.setItem(key, JSON.stringify({ date, left }));
      window.dispatchEvent(new Event("flux:ai:token:consume"));
      return true;
    } catch {
      return true;
    }
  }

  useEffect(() => {
    try {
      const s = localStorage.getItem("flux:xpost:style") || "casual";
      setXStyle(s);
    } catch {}
  }, []);

  useEffect(() => {
    if (!open || !article?.link) return;
    if (!tryConsumeToken()) {
      toast.error(lang === "fr" ? "Plus de tokens aujourd'hui." : "No tokens left today.");
      return;
    }
    setLoading(true);
    setSummary("");
    setLoadingStep(0);
    try {
      setDateStr(article.pubDate ? format(new Date(article.pubDate), "d MMM yyyy", { locale: fr }) : "");
    } catch { setDateStr(""); }
    const controller = new AbortController();
    (async () => {
      try {
        let apiKey = "";
        try { apiKey = localStorage.getItem("flux:ai:openai") || ""; } catch {}
        // petit carousel de messages pendant le fetch
        const interval = setInterval(() => setLoadingStep((s) => (s + 1) % 6), 1200);
        const res = await fetch("/api/ai/summarize-tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: article.link, lang, apiKey: apiKey || undefined, textOnly: true }),
          signal: controller.signal,
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "summary failed");
        const text = (json?.text as string) || "";
        setSummary(text);
        clearInterval(interval);
      } catch {
        // Fallback client: récupérer l'article et résumer côté navigateur via la clé OpenAI locale
        try {
          let apiKey = "";
          try { apiKey = localStorage.getItem("flux:ai:openai") || ""; } catch {}
          if (!apiKey) throw new Error("no-api-key");
          // 1) Récupérer du texte lisible
          const art = await fetch("/api/article", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: article.link }),
            signal: controller.signal,
          }).then(r => r.ok ? r.json() : Promise.reject(new Error("article-fail")) ) as { contentHtml?: string };
          const html = (art?.contentHtml || "").toString();
          const tmp = document.createElement("div");
          tmp.innerHTML = html;
          const base = tmp.textContent || tmp.innerText || "";
          const cleaned = base.replace(/[\u0000-\u001F\u007F]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 4000);
          if (!cleaned || cleaned.length < 120) throw new Error("too-short");
          // 2) Appel très léger au modèle
          const prompt = lang === "fr"
            ? "Résume clairement et factuellement en 6 à 10 puces + une phrase TL;DR en tête. Pas d'emojis.\n\n"
            : "Summarize clearly and factually: TL;DR one sentence + 6-10 bullets. No emojis.\n\n";
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 12000);
          const aiRes = await fetch("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({ model: "gpt-5-nano", input: `${prompt}${cleaned}` }),
            signal: ctrl.signal,
          }).catch(() => null);
          clearTimeout(t);
          if (aiRes && aiRes.ok) {
            const j = await aiRes.json();
            const text = (() => {
              const ot = j?.output_text; if (typeof ot === "string" && ot.trim()) return ot;
              const out = Array.isArray(j?.output) ? j.output : [];
              for (const o of out) {
                const c = Array.isArray(o?.content) ? o.content : [];
                for (const cc of c) { if (typeof cc?.text === "string" && cc.text.trim()) return cc.text; }
              }
              return "";
            })();
            if (text && text.trim()) {
              setSummary(text.trim());
              return;
            }
          }
          // Dernier recours: tronquer le texte propre
          setSummary(cleaned.slice(0, 800));
        } catch {
          setSummary(lang === "fr" ? "Impossible de générer le résumé de cet article." : "Failed to generate the article summary.");
        }
      } finally {
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [open, article?.link, article?.pubDate, lang]);

  const themeClass = useMemo(() => {
    if (resolvedTheme === "dark") return "bg-[#0b0b0b] text-[#e5e5e5]";
    return "bg-white text-black";
  }, [resolvedTheme]);

  // dateStr set in effect

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={
          "p-0 border-0 bg-transparent shadow-none rounded-none data-[state=open]:slide-in-from-bottom-4 data-[state=closed]:slide-out-to-bottom-4 w-[1000px] max-w-[98vw]"
        }
        overlayClassName={resolvedTheme === "dark" ? "bg-neutral-900" : "bg-neutral-100"}
        noMaxWidth
        showCloseButton={false}
        aria-describedby={undefined}
      >
        <div className={`border-0 ${themeClass} max-h-[92vh] flex flex-col shadow-2xl shadow-black/20`}> 
          <DialogHeader className="p-6 pb-2" aria-describedby={undefined}>
            <div className="mx-auto w-full max-w-[900px] px-1 sm:px-2">
              <DialogTitle className="text-3xl md:text-4xl font-semibold leading-tight tracking-tight">
                {article?.title || ""}
              </DialogTitle>
            </div>
          </DialogHeader>
          <div className={`mx-auto w-full max-w-[900px] px-1 sm:px-2 pb-4 pt-0 text-[13px] opacity-70 flex items-center gap-3`}>
            <span>{dateStr}</span>
            {article?.link ? (
              <a
                href={article.link}
                target="_blank"
                rel="noreferrer"
                className="text-[12px] underline opacity-80 hover:opacity-100"
              >
                {lang === "fr" ? "Voir l’article original" : "Open original article"}
              </a>
            ) : null}
            {summary ? (
              <>
                <button
                  type="button"
                  className="text-[12px] underline opacity-80 hover:opacity-100"
          onClick={async (e) => {
                    e.preventDefault();
                    try {
                      if (!summary) return;
                      if (navigator.clipboard?.writeText) {
                        await navigator.clipboard.writeText(summary);
                      } else {
                        const ta = document.createElement("textarea");
                        ta.value = summary;
                        document.body.appendChild(ta);
                        ta.select();
                        document.execCommand("copy");
                        document.body.removeChild(ta);
                      }
                      toast.success(lang === "fr" ? "Résumé copié" : "Summary copied");
              } catch {}
                  }}
                >
                  {lang === "fr" ? "Copier le résumé" : "Copy summary"}
                </button>
                <span>•</span>
                <button
                  type="button"
                  className="text-[12px] underline opacity-80 hover:opacity-100"
              onClick={(e) => {
                    e.preventDefault();
                    setXOpen(true);
                    setXText("");
                  }}
                >
                  {t(lang, "writeAbout")}
                </button>
              </>
            ) : null}
          </div>
          <div className={`px-5 pb-6 pt-2 flex-1 overflow-y-auto`}> 
            {loading ? (
              <div className="py-16 text-center text-sm opacity-80 select-none">
                <LoadingMessages lang={lang} step={loadingStep} />
              </div>
            ) : (
              <div className="mx-auto w-full max-w-[900px] px-1 sm:px-2">
                <StructuredSummary summary={summary} imageUrl={imageUrl} />
              </div>
            )}
          </div>
        </div>
        <DialogFooter />
      </DialogContent>
    </Dialog>

    {/* Modale de génération Post X */}
    <Dialog open={xOpen} onOpenChange={setXOpen}>
      <DialogContent className="w-[92vw] max-w-2xl sm:max-w-3xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t(lang, "writeAbout")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="text-sm text-muted-foreground space-y-1">
            {article?.title ? (
              <div className="min-w-0 break-words">
                <strong className="mr-1">Titre:</strong>
                <span className="break-words">{article.title}</span>
              </div>
            ) : null}
            {article?.link ? (
              <div className="min-w-0 break-all overflow-hidden">
                <strong className="mr-1">URL:</strong>
                <span className="break-all">{article.link}</span>
              </div>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label className="text-sm">{t(lang, "writingStyleLabel")}</Label>
            <select
              className="w-full bg-background border rounded-md px-3 py-2 text-sm"
              value={xStyle}
              onChange={(e) => {
                const v = e.target.value;
                setXStyle(v);
                try { localStorage.setItem("flux:xpost:style", v); } catch {}
              }}
            >
              <option value="casual">{t(lang, "styleCasual")}</option>
              <option value="concise">{t(lang, "styleConcise")}</option>
              <option value="journalistic">{t(lang, "styleJournalistic")}</option>
              <option value="analytical">{t(lang, "styleAnalytical")}</option>
              <option value="enthusiastic">{t(lang, "styleEnthusiastic")}</option>
              <option value="technical">{t(lang, "styleTechnical")}</option>
              <option value="humorous">{t(lang, "styleHumorous")}</option>
              <option value="formal">{t(lang, "styleFormal")}</option>
              <option value="very_personal">{t(lang, "styleVeryPersonal")}</option>
            </select>
            <p className="text-xs text-muted-foreground">{t(lang, "writingStyleHelp")}</p>
          </div>
          <textarea
            className="w-full h-[28vh] min-h-[180px] max-h-[50vh] resize-vertical overflow-auto border rounded-md bg-background p-3 text-sm leading-relaxed"
            value={xText}
            placeholder={lang === "fr" ? "Le post généré apparaîtra ici…" : "The generated post will appear here…"}
            onChange={(e) => setXText(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              disabled={xLoading}
              onClick={async () => {
                if (!tryConsumeToken()) {
                  toast.error(lang === "fr" ? "Plus de tokens aujourd'hui." : "No tokens left today.");
                  return;
                }
                if (!article?.link) return;
                setXLoading(true);
                try {
                  let apiKey = "";
                  try { apiKey = localStorage.getItem("flux:ai:openai") || ""; } catch {}
                  const res = await fetch("/api/ai/generate-x-post", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      title: article?.title || "",
                      summary,
                      url: article.link,
                      lang,
                      apiKey: apiKey || undefined,
                      style: xStyle || "casual",
                    }),
                  });
                  const j = await res.json();
                  if (!res.ok) throw new Error(j?.error || "failed");
                  const text = (j.text as string) || "";
                  const appended = text ? `${text} ${article.link}` : article.link;
                  setXText(appended);
                } catch {
                  toast.error(lang === "fr" ? "Génération du post échouée" : "Post generation failed");
                } finally {
                  setXLoading(false);
                }
              }}
            >
              {xLoading ? (t(lang, "generatingPost")) : (t(lang, "generatePost"))}
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  if (!xText) return;
                  if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(xText);
                  else {
                    const ta = document.createElement("textarea");
                    ta.value = xText;
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand("copy");
                    document.body.removeChild(ta);
                  }
                  toast.success(t(lang, "postCopied"));
                } catch {}
              }}
            >
              {t(lang, "copyPost")}
            </Button>
            <Button
              variant="secondary"
              onClick={async () => {
                // Ouvrir X avec un nouveau post et tenter de coller automatiquement via clipboard + focus
                try {
                  const text = xText || "";
                  const url = "https://x.com/intent/tweet?text=" + encodeURIComponent(text);
                  window.open(url, "_blank", "noopener,noreferrer");
                } catch {}
              }}
            >
              {t(lang, "postOnX")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}

function LoadingMessages({ lang, step }: { lang: "fr" | "en"; step: number }) {
  const msgsFr = [
    "On enlève les pubs et on garde l'essentiel…",
    "On lit vite, on résume mieux…",
    "On retire les chiffres ronflants…",
    "On remet les infos dans l'ordre…",
    "On chasse le superflu…",
    "On polit les phrases pour vous…",
  ];
  const msgsEn = [
    "Stripping ads, keeping the signal…",
    "Skimming fast, summarizing better…",
    "Deflating hype, keeping facts…",
    "Putting the story back in order…",
    "Trimming the fluff…",
    "Polishing sentences for you…",
  ];
  const arr = lang === "fr" ? msgsFr : msgsEn;
  return <span>{arr[step % arr.length]}</span>;
}

function StructuredSummary({ summary, imageUrl }: { summary: string; imageUrl?: string }) {
  if (!summary) return null;
  // Découpe en sections sur mots-clés connus
  const lines = summary.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  let tldr = "";
  const bullets: string[] = [];
  const rest: string[] = [];
  let quote: string | null = null;
  let mode: "tldr" | "bullets" | "rest" | "quote" = "tldr";
  for (const l of lines) {
    const low = l.toLowerCase();
    if (/^tl;?dr/.test(low)) { tldr = l.replace(/^tl;?dr[:\-]?\s*/i, ""); mode = "bullets"; continue; }
    if (/^(points clés|key points)/i.test(low)) { mode = "bullets"; continue; }
    if (/^(quote|citation)/i.test(low)) { mode = "quote"; quote = l.replace(/^(quote|citation)[:\-]?\s*/i, ""); continue; }
    if (/^(contexte|context|à suivre|what to watch)/i.test(low)) { mode = "rest"; rest.push(l); continue; }
    if (mode === "bullets" && /^[-•]/.test(l)) { bullets.push(l.replace(/^[-•]\s*/, "")); continue; }
    if (mode === "quote") { quote = (quote ? quote + " " : "") + l; continue; }
    if (mode === "tldr") { tldr = (tldr ? tldr + " " : "") + l; continue; }
    rest.push(l);
  }

  return (
    <article className="prose prose-neutral dark:prose-invert prose-lg leading-8 tracking-[0.005em] max-w-none">
      <div className="space-y-4">
        {imageUrl ? (
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/proxy-image/${btoa(imageUrl).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")}`}
              alt=""
              className="w-full max-h-80 object-cover rounded"
              referrerPolicy="no-referrer"
            />
          </div>
        ) : null}
        {tldr ? (
          <p className="text-muted-foreground"><strong className="font-semibold">TL;DR:</strong> {tldr}</p>
        ) : null}
        {bullets.length ? (
          <ul>
            {bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        ) : null}
        {quote ? (
          <blockquote className="border-l-4 pl-4 italic text-muted-foreground text-xl font-semibold">
            “{quote}”
          </blockquote>
        ) : null}
        {rest.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
    </article>
  );
}


