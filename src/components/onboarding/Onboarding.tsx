"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLang, t } from "@/lib/i18n";

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
      title: t(lang, "onboardingWelcomeTitle"),
      desc: t(lang, "onboardingWelcomeDesc"),
      videoEmbed: "https://www.youtube-nocookie.com/embed/3wlL_2347yY?rel=0&modestbranding=1&playsinline=1",
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
            <Button variant="ghost" onClick={finish}>{t(lang, "onboardingSkip")}</Button>
            <div className="flex items-center gap-2">
              {step > 0 && (
                <Button variant="outline" onClick={() => setStep((s) => Math.max(0, s - 1))}>{t(lang, "onboardingBack")}</Button>
              )}
              {step < slides.length - 1 ? (
                <Button onClick={() => setStep((s) => Math.min(slides.length - 1, s + 1))}>{t(lang, "onboardingNext")}</Button>
              ) : (
                <Button onClick={finish}>{t(lang, "onboardingDone")}</Button>
              )}
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


