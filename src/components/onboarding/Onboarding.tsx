"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLang } from "@/lib/i18n";

export function Onboarding() {
  const [lang] = useLang();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    // First visit: show if not seen
    try {
      const seen = localStorage.getItem("flux:onboarding:seen");
      if (!seen) setOpen(true);
    } catch {}
  }, []);

  useEffect(() => {
    const on = (_e: Event) => {
      setStep(0);
      setOpen(true);
    };
    window.addEventListener("flux:onboarding:open", on);
    return () => window.removeEventListener("flux:onboarding:open", on);
  }, []);

  function finish() {
    setOpen(false);
    try { localStorage.setItem("flux:onboarding:seen", "1"); } catch {}
  }

  const slides: Array<{ title: string; desc: string; videoEmbed?: string }> = [
    {
      title: lang === "fr" ? "Bienvenue dans Flux" : "Welcome to Flux",
      desc: lang === "fr"
        ? "Flux est un lecteur RSS minimaliste. Ajoute tes sources, organise-les et parcours l’actualité au quotidien."
        : "Flux is a minimalist RSS reader. Add your sources, organize them, and browse daily news.",
      videoEmbed: "https://www.youtube-nocookie.com/embed/3wlL_2347yY?rel=0&modestbranding=1&playsinline=1",
    },
    {
      title: lang === "fr" ? "Ajouter et organiser" : "Add and organize",
      desc: lang === "fr"
        ? "Clique sur + pour ajouter un flux, crée des dossiers et réorganise en glissant-déposant."
        : "Click + to add feeds, create folders, and reorder with drag and drop.",
    },
    {
      title: lang === "fr" ? "Résumé audio & IA" : "Audio & AI",
      desc: lang === "fr"
        ? "Lis un résumé audio des articles ou l’actualité du jour. Renseigne ta clé OpenAI dans Réglages pour activer l’IA."
        : "Listen to audio summaries or today’s digest. Add your OpenAI key in Settings to enable AI.",
    },
    {
      title: lang === "fr" ? "Résumé du jour" : "Today resume",
      desc: lang === "fr"
        ? "Dans Aperçu → Résumé du jour, génère une synthèse éditoriale des dernières 24h (images, titres, liens)."
        : "In Overview → Today resume, generate an editorial summary of the last 24h (images, titles, links).",
    },
    {
      title: lang === "fr" ? "Réglages & sauvegarde" : "Settings & backup",
      desc: lang === "fr"
        ? "Personnalise le thème et la langue, exporte/importes tes flux et dossiers depuis Réglages."
        : "Customize theme and language, export/import your feeds and folders from Settings.",
    },
  ];

  const current = slides[step];
  const large = !!current.videoEmbed && step === 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) finish(); }}>
      <DialogContent className={large ? "w-[92vw] max-w-4xl md:max-w-5xl" : undefined}>
        <DialogHeader>
          <DialogTitle>{current.title}</DialogTitle>
          <DialogDescription>{current.desc}</DialogDescription>
        </DialogHeader>
        {current.videoEmbed ? (
          <div className="mt-3 rounded-xl overflow-hidden bg-black">
            <div className="relative w-full pt-[56.25%]">
              <iframe
                src={current.videoEmbed}
                className="absolute inset-0 w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <div className="w-full flex items-center justify-between">
            <Button variant="ghost" onClick={finish}>{lang === "fr" ? "Passer" : "Skip"}</Button>
            <div className="flex items-center gap-2">
              {step > 0 && (
                <Button variant="outline" onClick={() => setStep((s) => Math.max(0, s - 1))}>{lang === "fr" ? "Précédent" : "Back"}</Button>
              )}
              {step < slides.length - 1 ? (
                <Button onClick={() => setStep((s) => Math.min(slides.length - 1, s + 1))}>{lang === "fr" ? "Suivant" : "Next"}</Button>
              ) : (
                <Button onClick={finish}>{lang === "fr" ? "Terminer" : "Done"}</Button>
              )}
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


