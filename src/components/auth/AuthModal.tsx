"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLang, t } from "@/lib/i18n";
import { Loader2 } from "lucide-react";

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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t(lang, "loginTitle")}</DialogTitle>
          <DialogDescription>{t(lang, "loginDescription")}</DialogDescription>
        </DialogHeader>
        <div className="pt-2">
          <Button
            className="w-full"
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
            {authLoading || checking ? (
              <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> {t(lang, "loginWithGoogle")}</span>
            ) : (
              t(lang, "loginWithGoogle")
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}


