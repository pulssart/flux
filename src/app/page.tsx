"use client";

import { useEffect, useMemo, useState } from "react";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { FeedGrid } from "@/components/feeds/FeedGrid";
import { Overview } from "@/components/overview/Overview";
import { Onboarding } from "@/components/onboarding/Onboarding";
import { AuthModal } from "@/components/auth/AuthModal";
import { Button } from "@/components/ui/button";
import { Settings2 } from "lucide-react";

export default function Home() {
  const [selectedFeedIds, setSelectedFeedIds] = useState<string[]>([]);
  const [sidebarWidth, setSidebarWidth] = useState<number>(280);
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [feedsVersion, setFeedsVersion] = useState<number>(0);
  const [showOverview, setShowOverview] = useState<boolean>(false);
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);

  useEffect(() => {
    try {
      const ua = navigator.userAgent || navigator.vendor || "";
      const m = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
      setIsMobile(m);
    } catch {
      setIsMobile(false);
    }
  }, []);

  useEffect(() => {
    // Récupérer l'état de session pour afficher un bouton login en mobile si nécessaire
    (async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (res.ok) {
          const j = (await res.json()) as { user: { email: string | null } | null };
          setSessionEmail(j.user?.email ?? null);
        }
      } catch {}
    })();
  }, []);

  const gridStyle = useMemo(() => {
    if (isMobile) {
      return {
        gridTemplateColumns: "1fr",
        "--sidebar-w": "0px",
      } as React.CSSProperties & Record<string, string>;
    }
    const width = collapsed ? 56 : sidebarWidth;
    const style: React.CSSProperties & Record<string, string> = {
      gridTemplateColumns: `${width}px 1fr`,
      // variable CSS pour la largeur de la sidebar (utilisée par l'overlay d'arrière-plan)
      "--sidebar-w": `${width}px`,
    };
    return style;
  }, [collapsed, sidebarWidth, isMobile]);

  return (
    <div className="min-h-screen grid" style={gridStyle}>
      {isMobile ? (
        <div className="hidden">
          <Sidebar
            onSelectFeeds={(ids) => {
              setSelectedFeedIds(ids);
              setShowOverview(ids.length === 0);
            }}
            width={sidebarWidth}
            collapsed
            onToggleCollapse={() => {}}
            onResize={() => {}}
            onFeedsChanged={() => {}}
          />
        </div>
      ) : (
        <Sidebar
          onSelectFeeds={(ids) => {
            setSelectedFeedIds(ids);
            setShowOverview(ids.length === 0);
          }}
          width={sidebarWidth}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((v) => !v)}
          onResize={(w) => setSidebarWidth(Math.max(200, Math.min(520, Math.round(w))))}
          onFeedsChanged={() => setFeedsVersion((v) => v + 1)}
        />
      )}
      <main className="p-6" id="flux-main">
        <Onboarding />
        {!isMobile && <AuthModal />}
        {isMobile ? (
          <div className="fixed top-3 right-3 z-50 flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                try { window.dispatchEvent(new Event("flux:settings:open")); } catch {}
              }}
              aria-label="Réglages"
              title="Réglages"
            >
              <Settings2 className="w-4 h-4" />
            </Button>
            {!sessionEmail ? (
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    const res = await fetch("/api/auth/login", { method: "POST" });
                    const j = await res.json().catch(() => ({}));
                    if (j?.url) window.location.href = j.url as string;
                  } catch {}
                }}
              >
                Se connecter
              </Button>
            ) : null}
          </div>
        ) : null}
        {isMobile ? (
          <Overview isMobile />
        ) : showOverview ? (
          <Overview />
        ) : (
          <FeedGrid feedIds={selectedFeedIds} refreshKey={feedsVersion} />
        )}
      </main>
    </div>
  );
}
