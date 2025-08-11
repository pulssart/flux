"use client";

import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { t, useLang } from "@/lib/i18n";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

type ReaderModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  article: { title: string; link?: string; pubDate?: string } | null;
};

type ArticlePayload = { title?: string | null; date?: string | null; contentHtml?: string };

export function ReaderModal({ open, onOpenChange, article }: ReaderModalProps) {
  const [lang] = useLang();
  const [font, setFont] = useState<string>(() => {
    try { return localStorage.getItem("flux:reader:font") || "serif"; } catch { return "serif"; }
  });
  const [theme, setTheme] = useState<string>(() => {
    try { return localStorage.getItem("flux:reader:theme") || "light"; } catch { return "light"; }
  });
  const [loading, setLoading] = useState(false);
  const [payload, setPayload] = useState<ArticlePayload | null>(null);

  useEffect(() => {
    if (!open || !article?.link) return;
    setLoading(true);
    setPayload(null);
    const controller = new AbortController();
    fetch("/api/article", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: article.link }),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("fail");
        return (await res.json()) as ArticlePayload;
      })
      .then((json) => setPayload(json))
      .catch(() => setPayload({ title: article.title, date: article.pubDate, contentHtml: undefined }))
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [open, article?.link, article?.pubDate, article?.title]);

  useEffect(() => {
    try { localStorage.setItem("flux:reader:font", font); } catch {}
  }, [font]);
  useEffect(() => {
    try { localStorage.setItem("flux:reader:theme", theme); } catch {}
  }, [theme]);

  const themeClass = useMemo(() => {
    if (theme === "sepia") return "bg-[#f4ecd8] text-[#2e2618]";
    if (theme === "dark") return "bg-[#0b0b0b] text-[#e5e5e5]";
    return "bg-white text-black";
  }, [theme]);

  const fontClass = useMemo(() => {
    if (font === "sans") return "font-sans";
    if (font === "mono") return "font-mono";
    return "font-serif";
  }, [font]);

  const dateStr = useMemo(() => {
    const d = article?.pubDate || payload?.date || null;
    if (!d) return "";
    try { return format(new Date(d), "d MMM yyyy", { locale: fr }); } catch { return d; }
  }, [article?.pubDate, payload?.date]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={
          "p-0 w-[1000px] max-w-[98vw] border-0 bg-transparent shadow-none rounded-none data-[state=open]:slide-in-from-bottom-4 data-[state=closed]:slide-out-to-bottom-4"
        }
        overlayClassName="bg-neutral-100"
        showCloseButton
      >
        <div className={`border-0 ${themeClass} max-h-[92vh] flex flex-col`}> 
          <DialogHeader className="p-6 pb-2">
            <DialogTitle className="text-3xl md:text-4xl font-semibold leading-tight tracking-tight">
              {article?.title || payload?.title || ""}
            </DialogTitle>
          </DialogHeader>
          <div className={`px-6 pb-4 pt-0 text-[13px] opacity-70`}>{dateStr}</div>
          <div className="px-3">
            <div className="flex items-center gap-2 p-2">
              <div className="text-xs opacity-70">Font</div>
              <div className="flex gap-1">
                <Button variant={font === "serif" ? "default" : "outline"} size="sm" onClick={() => setFont("serif")}>Serif</Button>
                <Button variant={font === "sans" ? "default" : "outline"} size="sm" onClick={() => setFont("sans")}>Sans</Button>
                <Button variant={font === "mono" ? "default" : "outline"} size="sm" onClick={() => setFont("mono")}>Mono</Button>
              </div>
              <div className="ml-4 text-xs opacity-70">Theme</div>
              <div className="flex gap-1">
                <Button variant={theme === "light" ? "default" : "outline"} size="sm" onClick={() => setTheme("light")}>{t(lang, "light")}</Button>
                <Button variant={theme === "sepia" ? "default" : "outline"} size="sm" onClick={() => setTheme("sepia")}>Sepia</Button>
                <Button variant={theme === "dark" ? "default" : "outline"} size="sm" onClick={() => setTheme("dark")}>{t(lang, "dark")}</Button>
              </div>
              {article?.link && (
                <div className="ml-auto">
                  <a
                    href={article.link}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs underline opacity-80 hover:opacity-100"
                  >
                    Ouvrir l’article original
                  </a>
                </div>
              )}
            </div>
          </div>
          <div className={`px-5 pb-6 pt-2 ${fontClass} flex-1 overflow-y-auto`}> 
            {loading ? (
              <div className="py-10 text-center text-sm opacity-70">Chargement…</div>
            ) : payload?.contentHtml ? (
              <div className="mx-auto w-full max-w-[760px] px-1 sm:px-2">
                <article
                  className="prose prose-neutral dark:prose-invert prose-lg leading-8 tracking-[0.005em] max-w-none prose-pre:overflow-x-auto"
                  dangerouslySetInnerHTML={{ __html: payload.contentHtml || "" }}
                />
              </div>
            ) : (
              <div className="mx-auto w-full max-w-[760px] px-1 sm:px-2">
                <article className="prose prose-neutral dark:prose-invert prose-lg leading-8 tracking-[0.005em] max-w-none whitespace-pre-wrap">
                  {article?.title}
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


