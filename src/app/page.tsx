"use client";

import { useEffect, useMemo, useState } from "react";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { FeedGrid } from "@/components/feeds/FeedGrid";
import { Overview } from "@/components/overview/Overview";
import { Onboarding } from "@/components/onboarding/Onboarding";
import { AuthModal } from "@/components/auth/AuthModal";

export default function Home() {
  const [selectedFeedIds, setSelectedFeedIds] = useState<string[]>([]);
  const [sidebarWidth, setSidebarWidth] = useState<number>(280);
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [feedsVersion, setFeedsVersion] = useState<number>(0);
  const [showOverview, setShowOverview] = useState<boolean>(false);
  const [isMobile, setIsMobile] = useState<boolean>(false);

  useEffect(() => {
    try {
      const ua = navigator.userAgent || navigator.vendor || (window as any).opera || "";
      const m = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
      setIsMobile(m);
    } catch {
      setIsMobile(false);
    }
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
      {!isMobile && (
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
        <AuthModal />
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
