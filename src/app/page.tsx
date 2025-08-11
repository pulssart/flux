"use client";

import { useMemo, useState } from "react";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { FeedGrid } from "@/components/feeds/FeedGrid";
import { Overview } from "@/components/overview/Overview";
import { Onboarding } from "@/components/onboarding/Onboarding";

export default function Home() {
  const [selectedFeedIds, setSelectedFeedIds] = useState<string[]>([]);
  const [sidebarWidth, setSidebarWidth] = useState<number>(280);
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [feedsVersion, setFeedsVersion] = useState<number>(0);
  const [showOverview, setShowOverview] = useState<boolean>(false);

  const gridStyle = useMemo(() => {
    const width = collapsed ? 56 : sidebarWidth;
    return {
      gridTemplateColumns: `${width}px 1fr`,
      // variable CSS pour la largeur de la sidebar (utilisée par l'overlay d'arrière-plan)
      ["--sidebar-w" as any]: `${width}px`,
    } as React.CSSProperties;
  }, [collapsed, sidebarWidth]);

  return (
    <div className="min-h-screen grid" style={gridStyle}>
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
      <main className="p-6" id="flux-main">
        <Onboarding />
        {showOverview ? (
          <Overview />
        ) : (
          <FeedGrid feedIds={selectedFeedIds} refreshKey={feedsVersion} />
        )}
      </main>
    </div>
  );
}
