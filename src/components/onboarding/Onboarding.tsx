"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLang, t } from "@/lib/i18n";
import { PERSONAS, type Persona } from "@/lib/personas";
import { addFeed } from "@/lib/feeds-store";

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
    const on = () => {
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

  async function selectPersona(persona: Persona) {
    // Ajouter tous les flux du persona
    const feeds = PERSONAS[persona].feeds;
    for (const feed of feeds) {
      await addFeed(feed.url, feed.title);
    }
    // Passer à l'étape suivante
    setStep((s) => Math.min(slides.length - 1, s + 1));
  }

  const slides: Array<{ title: string; desc: string; videoEmbed?: string; isPersona?: boolean }> = [
    {
      title: t(lang, "onboardingWelcomeTitle"),
      desc: t(lang, "onboardingWelcomeDesc"),
      videoEmbed: "https://www.youtube-nocookie.com/embed/iTtya8l_ONU?rel=0&modestbranding=1&playsinline=1",
    },
    {
      title: t(lang, "onboardingPersonaTitle"),
      desc: t(lang, "onboardingPersonaDesc"),
      isPersona: true,
    },
    {
      title: t(lang, "onboardingAddOrganizeTitle"),
      desc: t(lang, "onboardingAddOrganizeDesc"),
    },
    {
      title: t(lang, "onboardingAudioAITitle"),
      desc: t(lang, "onboardingAudioAIDesc"),
    },
    {
      title: t(lang, "onboardingTodayResumeTitle"),
      desc: t(lang, "onboardingTodayResumeDesc"),
    },
    {
      title: t(lang, "onboardingSettingsBackupTitle"),
      desc: t(lang, "onboardingSettingsBackupDesc"),
    },
  ];

  const current = slides[step];
  const large = !!current.videoEmbed && step === 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) finish(); }}>
      <DialogContent className={large ? "w-[92vw] max-w-4xl md:max-w-5xl" : "sm:max-w-[600px] md:max-w-[800px]"}>
        <DialogHeader>
          <DialogTitle>{current.title}</DialogTitle>
          <DialogDescription>{current.desc}</DialogDescription>
        </DialogHeader>
        {current.isPersona ? (
          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-6 px-4">
            {(Object.entries(PERSONAS) as [Persona, typeof PERSONAS[Persona]][]).map(([key, persona]) => (
              <div key={key} className="flex flex-col gap-3 p-6 rounded-xl border bg-card hover:border-foreground/20 transition-colors">
                <h3 className="text-xl font-semibold">{persona.title[lang]}</h3>
                <p className="text-sm text-muted-foreground flex-grow">{persona.description[lang]}</p>
                <div className="mt-auto">
                  <Button 
                    className="w-full bg-background hover:bg-foreground hover:text-background transition-colors" 
                    variant="outline"
                    onClick={() => selectPersona(key)}
                  >
                    {t(lang, "onboardingPersonaSelect")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : current.videoEmbed ? (
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
          <div className="w-full flex items-center justify-between gap-4">
            {current.isPersona ? (
              <Button 
                variant="ghost" 
                className="text-muted-foreground hover:text-foreground transition-colors"
                onClick={finish}
              >
                {t(lang, "onboardingPersonaSkip")}
              </Button>
            ) : (
              <Button variant="ghost" onClick={finish}>{t(lang, "onboardingSkip")}</Button>
            )}
            <div className="flex items-center gap-2">
              {step > 0 && (
                <Button 
                  variant="outline" 
                  className="min-w-[80px]"
                  onClick={() => setStep((s) => Math.max(0, s - 1))}
                >
                  {t(lang, "onboardingBack")}
                </Button>
              )}
              {step < slides.length - 1 ? (
                <Button 
                  className="min-w-[80px] bg-foreground text-background hover:bg-foreground/90"
                  onClick={() => setStep((s) => Math.min(slides.length - 1, s + 1))}
                >
                  {t(lang, "onboardingNext")}
                </Button>
              ) : (
                <Button 
                  className="min-w-[80px] bg-foreground text-background hover:bg-foreground/90"
                  onClick={finish}
                >
                  {t(lang, "onboardingDone")}
                </Button>
              )}
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


