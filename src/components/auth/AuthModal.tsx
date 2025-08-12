"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLang, t } from "@/lib/i18n";
import { CheckCircle2, Loader2 } from "lucide-react";

export function AuthModal() {
  const [lang] = useLang();
  const [open, setOpen] = useState<boolean>(true);
  const [checking, setChecking] = useState<boolean>(true);
  const [authLoading, setAuthLoading] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (!res.ok) throw new Error("me failed");
        const j = (await res.json()) as { user: { email?: string | null } | null };
        if (!cancelled) {
          setOpen(!j.user);
        }
      } catch {
        if (!cancelled) setOpen(true);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Dialog open={open} onOpenChange={(v) => setOpen(v)}>
      <DialogContent className="max-w-lg p-0 overflow-hidden">
        <div className="relative">
          <div className="absolute inset-x-0 -top-24 h-24 bg-gradient-to-b from-primary/15 to-transparent pointer-events-none" />
          <div className="px-6 pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl overflow-hidden ring-1 ring-border">
                <Image src="/icon.png" alt="Flux" width={40} height={40} className="h-10 w-10 object-cover" />
              </div>
              <div>
                <DialogHeader>
                  <DialogTitle className="text-xl">{t(lang, "loginTitle")}</DialogTitle>
                  <DialogDescription>{t(lang, "loginDescription")}</DialogDescription>
                </DialogHeader>
              </div>
            </div>
          </div>

          <div className="px-6 pt-4">
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-2 text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-primary" /> {t(lang, "loginBenefitSync")}
              </li>
              <li className="flex items-center gap-2 text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-primary" /> {t(lang, "loginBenefitBackup")}
              </li>
              <li className="flex items-center gap-2 text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-primary" /> {t(lang, "loginBenefitSecurity")}
              </li>
            </ul>
          </div>

          <div className="px-6 pt-4 pb-6">
            <Button
              className="w-full bg-white text-foreground border hover:bg-white/90 shadow-sm dark:bg-card dark:hover:bg-card/90"
              disabled={authLoading || checking}
              onClick={async () => {
                setAuthLoading(true);
                try {
                  const res = await fetch("/api/auth/login", { method: "POST" });
                  const j = await res.json().catch(() => ({}));
                  if (j?.url) window.location.href = j.url as string;
                } finally {
                  setAuthLoading(false);
                }
              }}
            >
              <span className="inline-flex items-center gap-2">
                <span className="inline-flex items-center justify-center h-5 w-5 rounded bg-transparent">
                  {/* Google "G" icon */}
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className="h-5 w-5">
                    <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303C33.676 32.676 29.223 36 24 36 16.82 36 11 30.18 11 23S16.82 10 24 10c3.307 0 6.313 1.236 8.594 3.256l5.657-5.657C34.759 4.027 29.61 2 24 2 11.85 2 2 11.85 2 24s9.85 22 22 22c12.15 0 22-9.85 22-22 0-1.341-.138-2.651-.389-3.917z"/>
                    <path fill="#FF3D00" d="M6.306 14.691l6.571 4.818C14.238 15.242 18.78 12 24 12c3.307 0 6.313 1.236 8.594 3.256l5.657-5.657C34.759 4.027 29.61 2 24 2 16.318 2 9.715 6.063 6.306 14.691z"/>
                    <path fill="#4CAF50" d="M24 46c5.166 0 9.86-1.977 13.4-5.2l-6.2-5.238C29.006 37.907 26.64 39 24 39c-5.192 0-9.624-3.488-11.205-8.243l-6.49 5.005C9.663 41.864 16.313 46 24 46z"/>
                    <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-1.131 3.353-3.61 5.907-6.503 7.562.004-.003.007-.007.011-.01l6.2 5.238C33.676 41.676 38 36.5 38 29c0-1.341-.138-2.651-.389-3.917z"/>
                  </svg>
                </span>
                {authLoading || checking ? (
                  <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> {t(lang, "loginWithGoogle")}</span>
                ) : (
                  t(lang, "loginWithGoogle")
                )}
              </span>
            </Button>
            <p className="mt-3 text-xs text-muted-foreground">
              {t(lang, "loginPrivacyNote")}
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}


