"use client";

import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLang } from "@/lib/i18n";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { useTheme } from "next-themes";

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

  useEffect(() => {
    if (!open || !article?.link) return;
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
          body: JSON.stringify({ url: article.link, lang, apiKey: apiKey || undefined }),
          signal: controller.signal,
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "summary failed");
        const text = (json?.text as string) || "";
        setSummary(text);
        clearInterval(interval);
      } catch (e) {
        setSummary(lang === "fr" ? "Impossible de générer le résumé de cet article." : "Failed to generate the article summary.");
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={
          "p-0 border-0 bg-transparent shadow-none rounded-none data-[state=open]:slide-in-from-bottom-4 data-[state=closed]:slide-out-to-bottom-4 w-[1000px] max-w-[98vw]"
        }
        overlayClassName="bg-neutral-100"
        noMaxWidth
        showCloseButton={false}
      >
        <div className={`border-0 ${themeClass} max-h-[92vh] flex flex-col shadow-2xl shadow-black/20`}> 
          <DialogHeader className="p-6 pb-2">
            <DialogTitle className="text-3xl md:text-4xl font-semibold leading-tight tracking-tight">
              {article?.title || ""}
            </DialogTitle>
          </DialogHeader>
          <div className={`px-6 pb-4 pt-0 text-[13px] opacity-70 flex items-center gap-3`}>
            {imageUrl ? (
              <img
                src={`/api/proxy-image/${btoa(imageUrl).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")}`}
                alt=""
                className="h-6 w-6 rounded object-cover"
                referrerPolicy="no-referrer"
              />
            ) : null}
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
          </div>
          <div className={`px-5 pb-6 pt-2 flex-1 overflow-y-auto`}> 
            {loading ? (
              <div className="py-16 text-center text-sm opacity-80 select-none">
                <LoadingMessages lang={lang} step={loadingStep} />
              </div>
            ) : (
              <div className="mx-auto w-full max-w-[900px] px-1 sm:px-2">
                <article className="prose prose-neutral dark:prose-invert prose-lg leading-8 tracking-[0.005em] max-w-none whitespace-pre-wrap">
                  {summary
                    ? summary.split(/\n\n+/).map((block, i) => (
                        <p key={i}>{block}</p>
                      ))
                    : null}
                </article>
              </div>
            )}
          </div>
        </div>
        <DialogFooter />
      </DialogContent>
    </Dialog>
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


