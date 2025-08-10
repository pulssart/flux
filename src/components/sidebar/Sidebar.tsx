"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { DndContext, closestCenter } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Pencil, Trash2, PanelLeft, PanelRight, Settings2, Plus, Loader2, FolderPlus, Folder, ChevronDown, ChevronRight } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTheme } from "next-themes";
import { z } from "zod";
import { cn } from "@/lib/utils";
import { SUGGESTED_FEEDS } from "@/lib/suggestions";
import { clearFeedCache, clearImageCacheForFeed, countUnreadToday, markFeedOpenedToday, saveFeedItemsToCache, cacheImagesForFeed } from "@/lib/feed-cache";
import { useLang, t } from "@/lib/i18n";

type SidebarProps = {
  onSelectFeeds: (ids: string[]) => void;
  width?: number;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onResize?: (width: number) => void;
  onFeedsChanged?: () => void;
};

type FeedInfo = {
  id: string;
  title: string;
  url: string;
};

const FeedSchema = z.object({ id: z.string(), title: z.string(), url: z.string().url() });

type FolderInfo = {
  id: string;
  title: string;
  feedIds: string[];
  collapsed?: boolean;
};

const FolderSchema = z.object({ id: z.string(), title: z.string(), feedIds: z.array(z.string()), collapsed: z.boolean().optional() });

function loadFeeds(): FeedInfo[] {
  if (typeof window === "undefined") return [];
  try {
    const str = localStorage.getItem("flux:feeds");
    if (!str) return [];
    const arr = JSON.parse(str) as FeedInfo[];
    return arr.filter((f) => FeedSchema.safeParse(f).success);
  } catch {
    return [];
  }
}

function saveFeeds(feeds: FeedInfo[]) {
  localStorage.setItem("flux:feeds", JSON.stringify(feeds));
}

function loadFolders(): FolderInfo[] {
  if (typeof window === "undefined") return [];
  try {
    const str = localStorage.getItem("flux:folders");
    if (!str) return [];
    const arr = JSON.parse(str) as FolderInfo[];
    return arr.filter((f) => FolderSchema.safeParse(f).success);
  } catch {
    return [];
  }
}

function saveFolders(folders: FolderInfo[]) {
  localStorage.setItem("flux:folders", JSON.stringify(folders));
}

function exportAllData() {
  const feedsStr = localStorage.getItem("flux:feeds") || "[]";
  const foldersStr = localStorage.getItem("flux:folders") || "[]";
  const aiKey = localStorage.getItem("flux:ai:openai") || "";
  const aiVoice = localStorage.getItem("flux:ai:voice") || "alloy";
  const lang = localStorage.getItem("flux:lang") || "fr";
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    feeds: JSON.parse(feedsStr),
    folders: JSON.parse(foldersStr),
    settings: { aiKey, aiVoice, lang },
  };
}

type ImportData = { feeds?: unknown; folders?: unknown; settings?: { aiKey?: unknown; aiVoice?: unknown; lang?: unknown } };
function importAllData(json: ImportData) {
  try {
    if (!json || typeof json !== "object") throw new Error("invalid");
    const feeds = Array.isArray(json.feeds) ? (json.feeds as FeedInfo[]) : [];
    const folders = Array.isArray(json.folders) ? (json.folders as FolderInfo[]) : [];
    const settings = json.settings && typeof json.settings === "object" ? (json.settings as { aiKey?: unknown; aiVoice?: unknown; lang?: unknown }) : {};

    // bascule state
    localStorage.setItem("flux:feeds", JSON.stringify(feeds));
    localStorage.setItem("flux:folders", JSON.stringify(folders));
    if (typeof settings.aiKey === "string") localStorage.setItem("flux:ai:openai", settings.aiKey);
    if (typeof settings.aiVoice === "string") localStorage.setItem("flux:ai:voice", settings.aiVoice);
    if (typeof settings.lang === "string") localStorage.setItem("flux:lang", settings.lang);
  } catch (e) {
    throw e;
  }
}

export function Sidebar({ onSelectFeeds, width = 280, collapsed = false, onToggleCollapse, onResize, onFeedsChanged }: SidebarProps) {
  const [feeds, setFeeds] = useState<FeedInfo[]>([]);
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [newFeedUrl, setNewFeedUrl] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  // Suggestions: uniquement celles du fichier local `suggestions.ts`
  const mergedSuggestions = useMemo(() => SUGGESTED_FEEDS, []);

  // Plus de chargement distant: on se limite aux suggestions locales
  const [logoOk, setLogoOk] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [lang, setLang] = useLang();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [aiKey, setAiKey] = useState("");
  const [aiVoice, setAiVoice] = useState("alloy");
  useEffect(() => setMounted(true), []);

  const currentTheme = mounted ? (theme ?? resolvedTheme) : "light";
  const logoSrc = currentTheme === "dark" ? "/icon-dark.png" : "/icon.png";

  useEffect(() => {
    setFeeds(loadFeeds());
    setFolders(loadFolders());
    // Charger la clé API OpenAI depuis localStorage
    try {
      const k = localStorage.getItem("flux:ai:openai") || "";
      setAiKey(k);
      const v = localStorage.getItem("flux:ai:voice") || "alloy";
      setAiVoice(v);
    } catch {}
  }, []);

  useEffect(() => {
    onSelectFeeds(selectedIds);
  }, [selectedIds, onSelectFeeds]);

  // lang est géré par useLang() globalement
  function isFeedInAnyFolder(feedId: string): string | null {
    const f = folders.find((fd) => fd.feedIds.includes(feedId));
    return f ? f.id : null;
  }

  function addFolder() {
    const id = crypto.randomUUID();
    const folder: FolderInfo = { id, title: "Nouveau dossier", feedIds: [], collapsed: false };
    const next = [...folders, folder];
    setFolders(next);
    saveFolders(next);
  }

  function renameFolder(folderId: string, title: string) {
    const next = folders.map((f) => (f.id === folderId ? { ...f, title } : f));
    setFolders(next);
    saveFolders(next);
  }

  function removeFolder(folderId: string) {
    const f = folders.find((x) => x.id === folderId);
    const remaining = folders.filter((x) => x.id !== folderId);
    setFolders(remaining);
    saveFolders(remaining);
    if (f && f.feedIds.length) {
      // remettre les feeds en top-level (append)
      const reinjected = feeds.concat(
        f.feedIds
          .map((id) => feeds.find((ff) => ff.id === id))
          .filter((x): x is FeedInfo => !!x)
      );
      setFeeds(reinjected);
      saveFeeds(reinjected);
    }
  }

  function toggleFolderCollapsed(folderId: string) {
    const next = folders.map((f) => (f.id === folderId ? { ...f, collapsed: !f.collapsed } : f));
    setFolders(next);
    saveFolders(next);
  }


  // Rafraîchissement silencieux de chaque flux toutes les 10 minutes pour mettre à jour les badges
  useEffect(() => {
    let cancelled = false;
    async function refreshAllFeeds() {
      const list = loadFeeds();
      if (!list.length) return;
      try {
        await Promise.allSettled(
          list.map(async (f) => {
            try {
              const res = await fetch("/api/feeds", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: f.url }),
              });
              if (!res.ok) return;
              const data = (await res.json()) as { items?: Array<{ id: string; title: string; link?: string; pubDate?: string; contentSnippet?: string; image?: string }>; };
              const items = (data.items || []).map((it) => ({ ...it, source: f.url }));
              saveFeedItemsToCache(f.url, items);
              void cacheImagesForFeed(f.url, items);
            } catch {}
          })
        );
      } finally {
        if (!cancelled) setRefreshTick((n) => n + 1);
      }
    }
    // lancer au montage puis toutes les 10 minutes
    refreshAllFeeds();
    const id = setInterval(refreshAllFeeds, 10 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  async function addFeed(urlParam?: string) {
    setAdding(true);
    const url = (urlParam ?? newFeedUrl).trim();
    if (!url) return;

    let candidateUrl = "";
    let title = "";

    // 1) Tentative via /api/discover (20s)
    try {
      const res = await fetch("/api/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, timeoutMs: 20000 }),
      });
      if (res.ok) {
        const data = await res.json();
        candidateUrl = (data.feedUrl as string) || "";
        title = (data.title as string) || "";
      }
    } catch {}

    // 2) Si pas trouvé, tenter de parser directement l'URL saisie
    if (!candidateUrl) {
      try {
        const res = await fetch("/api/feeds", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });
        if (res.ok) {
          const data = await res.json();
          candidateUrl = url;
          title = (data.title as string) || "";
        }
      } catch {}
    }

    // 3) Si toujours rien: afficher toast d'alerte et sortir
    if (!candidateUrl) {
      toast.error("Aucun flux RSS détecté pour cette URL. Vérifie l’adresse ou essaie une autre page.");
      setAdding(false);
      return;
    }

    // 4) Si trouvé via discover, on valide avec /api/feeds pour être sûr et récupérer un titre fiable
    try {
      const res = await fetch("/api/feeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: candidateUrl }),
      });
      if (!res.ok) {
        toast.error("Aucun flux RSS détecté pour cette URL. Vérifie l’adresse ou essaie une autre page.");
        setAdding(false);
        return;
      }
      const data = await res.json();
      if (!title) title = (data.title as string) || "";
    } catch {
      toast.error("Aucun flux RSS détecté pour cette URL. Vérifie l’adresse ou essaie une autre page.");
      setAdding(false);
      return;
    }

    if (!title) title = humanizeSiteName(candidateUrl);

    const next: FeedInfo = {
      id: crypto.randomUUID(),
      title,
      url: candidateUrl,
    };
    const updated = [...feeds, next];
    setFeeds(updated);
    saveFeeds(updated);
    if (!urlParam) setNewFeedUrl("");
    setSelectedIds((ids) => Array.from(new Set([...ids, next.id])));
    onFeedsChanged?.();
    setAdding(false);
  }

  function humanizeSiteName(input: string): string {
    try {
      const { hostname } = new URL(input);
      const host = hostname.replace(/^www\./, "");
      const labels = host.split(".");
      // Prendre le label principal (avant le TLD), gérer cas type bbc.co.uk
      let base = labels.length > 2 && ["co", "com", "net", "org"].includes(labels[labels.length - 2])
        ? labels[labels.length - 3]
        : labels[0];
      base = base.replace(/[-_]+/g, " ");
      return base
        .split(" ")
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
    } catch {
      return input;
    }
  }

  function removeFeed(id: string) {
    const toRemove = feeds.find((f) => f.id === id);
    const updated = feeds.filter((f) => f.id !== id);
    setFeeds(updated);
    saveFeeds(updated);
    setSelectedIds((ids) => ids.filter((x) => x !== id));
    if (toRemove) {
      clearFeedCache(toRemove.url);
      void clearImageCacheForFeed(toRemove.url);
    }
    onFeedsChanged?.();
  }

  function renameFeed(id: string, title: string) {
    const updated = feeds.map((f) => (f.id === id ? { ...f, title } : f));
    setFeeds(updated);
    saveFeeds(updated);
    onFeedsChanged?.();
  }

  function toggleSelected(id: string) {
    // Sélection simple: affiche les articles du flux cliqué
    const feed = feeds.find((f) => f.id === id);
    if (feed) markFeedOpenedToday(feed.url);
    setSelectedIds([id]);
  }

  function parseDragId(raw: string | number): { kind: "feed" | "folder"; id: string } {
    const s = String(raw);
    if (s.startsWith("feed:")) return { kind: "feed", id: s.slice(5) };
    if (s.startsWith("folder:")) return { kind: "folder", id: s.slice(7) };
    // backward compat (old ids)
    const isFeed = feeds.some((f) => f.id === s);
    return { kind: isFeed ? "feed" : "folder", id: s };
  }

  function handleDragEnd(event: { active: { id: string | number }; over: { id: string | number } | null }) {
    const { active, over } = event;
    if (!over) return;
    const a = parseDragId(active.id);
    const b = parseDragId(over.id);
    if (a.kind === "feed" && b.kind === "folder") {
      // Déposer un feed dans un dossier (ne pas retirer l'objet du master list feeds[])
      const sourceFolderId = isFeedInAnyFolder(a.id);
      if (sourceFolderId) {
        const src = folders.find((f) => f.id === sourceFolderId)!;
        const updatedSrc = { ...src, feedIds: src.feedIds.filter((x) => x !== a.id) };
        const target = folders.find((f) => f.id === b.id)!;
        const updatedTarget = { ...target, feedIds: [...target.feedIds, a.id] };
        const nextFolders = folders.map((f) => (f.id === updatedSrc.id ? updatedSrc : f.id === updatedTarget.id ? updatedTarget : f));
        setFolders(nextFolders);
        saveFolders(nextFolders);
      } else {
        const target = folders.find((f) => f.id === b.id)!;
        const updatedTarget = { ...target, feedIds: [...target.feedIds, a.id] };
        const nextFolders = folders.map((f) => (f.id === updatedTarget.id ? updatedTarget : f));
        setFolders(nextFolders);
        saveFolders(nextFolders);
      }
      return;
    }
    if (a.kind === "folder" && b.kind === "folder") {
      // Réordonner les dossiers entre eux
      const oldIndex = folders.findIndex((f) => f.id === a.id);
      const newIndex = folders.findIndex((f) => f.id === b.id);
      if (oldIndex >= 0 && newIndex >= 0) {
        const updated = arrayMove(folders, oldIndex, newIndex);
        setFolders(updated);
        saveFolders(updated);
      }
      return;
    }
    if (a.kind === "feed" && b.kind === "feed") {
      // Réordonner soit top-level, soit à l'intérieur d'un même dossier, soit déplacer d'un dossier vers top-level
      const aFolder = isFeedInAnyFolder(a.id);
      const bFolder = isFeedInAnyFolder(b.id);
      if (aFolder && bFolder && aFolder === bFolder) {
        // même dossier → réordonner feedIds
        const folder = folders.find((f) => f.id === aFolder)!;
        const oldIndex = folder.feedIds.findIndex((x) => x === a.id);
        const newIndex = folder.feedIds.findIndex((x) => x === b.id);
        if (oldIndex >= 0 && newIndex >= 0) {
          const updatedFolder = { ...folder, feedIds: arrayMove(folder.feedIds, oldIndex, newIndex) };
          const nextFolders = folders.map((f) => (f.id === updatedFolder.id ? updatedFolder : f));
          setFolders(nextFolders);
          saveFolders(nextFolders);
        }
        return;
      }
      if (!aFolder && !bFolder) {
        // top-level → réordonner feeds[]
        const oldIndex = feeds.findIndex((f) => f.id === a.id);
        const newIndex = feeds.findIndex((f) => f.id === b.id);
        if (oldIndex >= 0 && newIndex >= 0) {
          const updated = arrayMove(feeds, oldIndex, newIndex);
          setFeeds(updated);
          saveFeeds(updated);
        }
        return;
      }
      if (aFolder && !bFolder) {
        // déplacer depuis dossier → top-level (placer avant b en réordonnant feeds[])
        const src = folders.find((f) => f.id === aFolder)!;
        const updatedSrc = { ...src, feedIds: src.feedIds.filter((x) => x !== a.id) };
        const oldIndex = feeds.findIndex((f) => f.id === a.id);
        const newIndex = feeds.findIndex((f) => f.id === b.id);
        let nextTop = feeds;
        if (oldIndex >= 0 && newIndex >= 0) {
          nextTop = arrayMove(feeds, oldIndex, newIndex);
        }
        setFolders(folders.map((f) => (f.id === updatedSrc.id ? updatedSrc : f)));
        saveFolders(folders.map((f) => (f.id === updatedSrc.id ? updatedSrc : f)));
        setFeeds(nextTop);
        saveFeeds(nextTop);
        return;
      }
    }
  }

  const empty = feeds.length === 0;

  function startResize(e: React.MouseEvent<HTMLDivElement>) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    function onMove(ev: MouseEvent) {
      const delta = ev.clientX - startX;
      onResize?.(startW + delta);
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return (
    <aside className="border-r border-border/50 h-dvh sticky top-0 flex flex-col bg-sidebar text-sidebar-foreground relative select-none">
      <div className="p-2 pl-3 pr-2 relative">
        <div className={cn("flex items-center gap-2", collapsed ? "justify-center" : "justify-between") }>
          {collapsed ? (
            <button
              className="group relative h-8 w-8"
              onClick={onToggleCollapse}
              aria-label="Déployer la sidebar"
            >
              {logoOk ? (
                <img
                  src={logoSrc}
                  alt="Flux"
                  className="absolute inset-0 h-8 w-8 object-contain transition-opacity group-hover:opacity-0"
                  onError={() => setLogoOk(false)}
                />
              ) : null}
              <span className="absolute inset-0 grid place-items-center transition-opacity opacity-0 group-hover:opacity-100">
                <PanelRight size={18} />
              </span>
            </button>
          ) : (
            <>
              {logoOk ? (
                <img
                  src={logoSrc}
                  alt="Flux"
                  className="h-8 w-8"
                  onError={() => setLogoOk(false)}
                />
              ) : (
                <div className="sr-only" aria-label="Flux" />
              )}
              <div className="flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setAddOpen(true)}
                  aria-label={t(lang, "addFeed")}
                >
                      <Plus size={16} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t(lang, "addFeed")}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={addFolder}
                  aria-label={t(lang, "addFolder")}
                >
                      <FolderPlus size={16} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t(lang, "addFolder")}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setSettingsOpen(true)}
                  aria-label={t(lang, "settingsTooltip")}
                >
                      <Settings2 size={16} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t(lang, "settingsTooltip")}</TooltipContent>
                </Tooltip>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={onToggleCollapse}
                  aria-label="Réduire la sidebar"
                >
                  <PanelLeft size={16} />
                </Button>
              </div>
            </>
          )}
        </div>
        {/* Champ d'ajout déplacé dans une modale */}
      </div>
      <Separator />
      {!collapsed ? (
        <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd} modifiers={[restrictToVerticalAxis]}>
          {/* Aperçu + Dossiers + Flux */}
          {(() => {
            const topLevelFeeds = feeds.filter((f) => !isFeedInAnyFolder(f.id));
            const sortableItems = [...folders.map((f) => `folder:${f.id}`), ...topLevelFeeds.map((f) => `feed:${f.id}`)];
            return (
              <SortableContext items={sortableItems} strategy={verticalListSortingStrategy}>
                <ScrollArea className="flex-1 min-h-0">
                  <ul className="p-2 space-y-1">
                    <li className="px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">{t(lang, "overview")}</li>
                    <li>
                      <button
                        className={cn(
                          "w-full text-left px-2 py-2 rounded border hover:bg-muted/50",
                          selectedIds.length === 0 ? "bg-secondary border-border" : "border-transparent"
                        )}
                        onClick={() => setSelectedIds([])}
                        title={t(lang, "todayResume")}
                      >
                        <span className="text-sm font-medium">{t(lang, "todayResume")}</span>
                      </button>
                    </li>
                    {folders.length > 0 && (
                      <li className="px-2 pt-2 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground">{t(lang, "sidebarFolders")}</li>
                    )}
                    {folders.map((folder) => (
                      <SidebarFolderItem
                        key={folder.id}
                        folder={folder}
                        feeds={feeds}
                        selectedIds={selectedIds}
                        onToggleFeed={toggleSelected}
                        onRenameFeed={renameFeed}
                        onRemoveFeed={removeFeed}
                        onRenameFolder={renameFolder}
                        onRemoveFolder={removeFolder}
                        onToggleCollapsed={toggleFolderCollapsed}
                        tick={refreshTick}
                      />
                    ))}
                    {topLevelFeeds.length > 0 && (
                      <li className="px-2 pt-2 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground">{t(lang, "sidebarFeeds")}</li>
                    )}
                    {topLevelFeeds.map((f) => (
                      <SidebarItem
                        key={f.id}
                        id={`feed:${f.id}`}
                        feedId={f.id}
                        title={f.title}
                        url={f.url}
                        selected={selectedIds.includes(f.id)}
                        onToggle={() => toggleSelected(f.id)}
                        onRemove={() => removeFeed(f.id)}
                        onRename={(t) => renameFeed(f.id, t)}
                        tick={refreshTick}
                      />
                    ))}
                    {empty && <li className="p-4 text-sm text-muted-foreground">{t(lang, "emptySidebar")}</li>}
                  </ul>
                </ScrollArea>
              </SortableContext>
            );
          })()}
        </DndContext>
      ) : (
        <ScrollArea className="flex-1 min-h-0">
          <ul className="p-2 space-y-2">
            {feeds.map((f) => (
              <CollapsedItem
                key={f.id}
                id={f.id}
                url={f.url}
                selected={selectedIds.includes(f.id)}
                onToggle={() => toggleSelected(f.id)}
              />
            ))}
            {empty && <li className="p-4 text-sm text-muted-foreground">{t(lang, "emptySidebar")}</li>}
          </ul>
        </ScrollArea>
      )}
      {/* poignée de redimensionnement (uniquement en mode étendu) */}
      {!collapsed && (
        <div
          className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-foreground/10"
          onMouseDown={startResize}
          role="separator"
          aria-orientation="vertical"
          aria-label="Redimensionner la sidebar"
        />
      )}

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t(lang, "settings")}</DialogTitle>
            <DialogDescription>{t(lang, "appearanceAndLanguage")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm">{t(lang, "theme")}</Label>
              <div className="flex gap-2">
                <Button variant={(mounted ? (theme ?? resolvedTheme) : "light") === "light" ? "default" : "outline"} onClick={() => setTheme("light")}>{t(lang, "light")}</Button>
                <Button variant={(mounted ? (theme ?? resolvedTheme) : "light") === "dark" ? "default" : "outline"} onClick={() => setTheme("dark")}>{t(lang, "dark")}</Button>
                <Button variant={(mounted ? (theme ?? resolvedTheme) : "light") === "system" ? "default" : "outline"} onClick={() => setTheme("system")}>{t(lang, "system")}</Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm">{t(lang, "language")}</Label>
              <div className="flex gap-2">
                <Button variant={lang === "fr" ? "default" : "outline"} onClick={() => setLang("fr")}>{t(lang, "french")}</Button>
                <Button variant={lang === "en" ? "default" : "outline"} onClick={() => setLang("en")}>{t(lang, "english")}</Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm">Clé API OpenAI (GPT-5 / TTS-1 HD)</Label>
              <Input
                type="password"
                placeholder="sk-..."
                value={aiKey}
                onChange={(e) => setAiKey(e.target.value)}
                onBlur={() => {
                  try {
                    localStorage.setItem("flux:ai:openai", aiKey.trim());
                  } catch {}
                }}
              />
              <p className="text-xs text-muted-foreground">Cette clé sera utilisée localement pour les fonctionnalités d’analyse et de synthèse vocale.</p>
            </div>
            <div className="space-y-2">
              <Label className="text-sm">Voix IA (TTS)</Label>
              <select
                className="w-full bg-background border rounded-md px-3 py-2 text-sm"
                value={aiVoice}
                onChange={(e) => {
                  const v = e.target.value;
                  setAiVoice(v);
                  try { localStorage.setItem("flux:ai:voice", v); } catch {}
                }}
              >
                <option value="alloy">Alloy</option>
                <option value="echo">Echo</option>
                <option value="fable">Fable</option>
                <option value="onyx">Onyx</option>
                <option value="nova">Nova</option>
                <option value="shimmer">Shimmer</option>
                <option value="coral">Coral</option>
                <option value="verse">Verse</option>
                <option value="ballad">Ballad</option>
                <option value="ash">Ash</option>
                <option value="sage">Sage</option>
              </select>
              <p className="text-xs text-muted-foreground">Choisissez la voix utilisée pour la lecture des résumés.</p>
            </div>
            <div className="space-y-2">
              <Label className="text-sm">Backup</Label>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    try {
                      const data = exportAllData();
                      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `flux-backup-${new Date().toISOString().slice(0,10)}.json`;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      URL.revokeObjectURL(url);
                      toast.success(t(lang, "exportReady"));
                    } catch (e) {
                      console.error(e);
                    }
                  }}
                >
                  {t(lang, "exportData")}
                </Button>
                <input
                  type="file"
                  accept="application/json"
                  className="hidden"
                  id="flux-import-file"
                  ref={importInputRef}
                  onChange={async (e) => {
                    const inputEl = e.currentTarget as HTMLInputElement;
                    const file = inputEl.files?.[0];
                    if (!file) return;
                    try {
                      const text = await file.text();
                      const json = JSON.parse(text);
                      importAllData(json);
                      toast.success(t(lang, "importSuccess"));
                      // recharger l’état
                      setFeeds(loadFeeds());
                      setFolders(loadFolders());
                      try {
                        const k = localStorage.getItem("flux:ai:openai") || "";
                        setAiKey(k);
                        const v = localStorage.getItem("flux:ai:voice") || "alloy";
                        setAiVoice(v);
                      } catch {}
                      setSettingsOpen(false);
                    } catch (e) {
                      console.error(e);
                      toast.error(t(lang, "importInvalid"));
                    } finally {
                      // reset input sans référencer l'event après await
                      if (inputEl) inputEl.value = "";
                    }
                  }}
                />
                <Button
                  variant="outline"
                  onClick={() => {
                    importInputRef.current?.click();
                  }}
                >
                  {t(lang, "importData")}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    window.dispatchEvent(new Event("flux:onboarding:open"));
                  }}
                >
                  {lang === "fr" ? "Relancer l’onboarding" : "Relaunch onboarding"}
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setSettingsOpen(false)}>{t(lang, "close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modale d'ajout de flux */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t(lang, "add")}</DialogTitle>
            <DialogDescription>{t(lang, "addUrlPlaceholder")}</DialogDescription>
          </DialogHeader>
          <div className="relative">
            <div className="flex gap-2">
              <Input
                placeholder={t(lang, "addUrlPlaceholder")}
                value={newFeedUrl}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 120)}
                onChange={(e) => setNewFeedUrl(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === "Enter") {
                    if (adding) return;
                    setAdding(true);
                    try {
                      await addFeed();
                      setAddOpen(false);
                    } finally {
                      setAdding(false);
                    }
                  }
                }}
                disabled={adding}
              />
              <Button
                variant="default"
                disabled={adding || !newFeedUrl.trim()}
                onClick={async () => {
                  if (adding) return;
                  setAdding(true);
                  try {
                    await addFeed();
                    setAddOpen(false);
                  } finally {
                    setAdding(false);
                  }
                }}
              >
                {adding ? (
                  <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Vérification…</span>
                ) : (
                  t(lang, "add")
                )}
              </Button>
            </div>
            {showSuggestions && (
              <div className="absolute left-0 right-0 top-full mt-2 rounded-md border bg-background overflow-hidden z-[9999] shadow-xl">
                <ul className="max-h-80 overflow-auto">
                  {filterSuggestions(mergedSuggestions, newFeedUrl).map((s) => (
                    <li key={s.url}>
                      <button
                        className="w-full text-left px-3 py-2 hover:bg-muted"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={async (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (adding) return;
                          setShowSuggestions(false);
                          setAdding(true);
                          try {
                            await addFeed(s.url);
                            setAddOpen(false);
                          } finally {
                            setAdding(false);
                          }
                        }}
                        disabled={adding}
                      >
                        <div className="text-sm font-medium">{s.title}</div>
                        <div className="text-xs text-muted-foreground">{s.url}</div>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </aside>
  );
}

function filterSuggestions(list: { title: string; url: string; domain?: string }[], q: string) {
  const query = q.trim().toLowerCase();
  if (!query) return list.slice(0, 50);
  return list
    .filter((s) => s.title.toLowerCase().includes(query) || s.url.toLowerCase().includes(query) || (s.domain?.toLowerCase().includes(query) ?? false))
    .slice(0, 50);
}

// mergeSuggestions supprimé: on garde la source locale uniquement

function SidebarItem({
  id,
  feedId,
  title,
  url,
  selected,
  onToggle,
  onRemove,
  onRename,
  tick,
}: {
  id: string; // accepte feed:xxx ou folder:xxx (pour le drag handle top-level)
  feedId: string; // id brut du feed pour badges
  title: string;
  url: string;
  selected: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onRename: (title: string) => void;
  tick: number;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const [lang] = useLang();
  useEffect(() => setValue(title), [title]);

  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  } as React.CSSProperties;

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "group flex items-center gap-2 px-2 py-2 rounded cursor-pointer border",
        selected ? "bg-secondary border-border" : "border-transparent hover:bg-muted/50"
      )}
      onClick={onToggle}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
    >
      <span className="relative shrink-0 h-5 w-5" onClick={(e) => e.stopPropagation()} aria-label="Favicon">
        <Favicon url={url} className="transition-opacity group-hover:opacity-0" />
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100 text-muted-foreground cursor-grab active:cursor-grabbing"
              {...attributes}
              {...listeners}
            >
              <GripVertical size={14} />
            </span>
          </TooltipTrigger>
          <TooltipContent>{t(lang, "reorder")}</TooltipContent>
        </Tooltip>
      </span>
      {editing ? (
        <input
          className="bg-transparent outline-none flex-1 min-w-0"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onRename(value.trim() || title);
              setEditing(false);
            }
            if (e.key === "Escape") setEditing(false);
          }}
          onBlur={() => {
            onRename(value.trim() || title);
            setEditing(false);
          }}
          autoFocus
        />
      ) : (
        <span
          className="flex-1 min-w-0 truncate text-sm"
          onDoubleClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
        >
          {title}
        </span>
      )}
      <div className="ml-2 flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="p-1 rounded hover:bg-foreground/5"
                onClick={() => setEditing(true)}
                aria-label={t(lang, "rename")}
              >
                <Pencil size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t(lang, "rename")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="p-1 rounded hover:bg-foreground/5"
                onClick={() => onRemove()}
                aria-label={t(lang, "remove")}
              >
                <Trash2 size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t(lang, "remove")}</TooltipContent>
          </Tooltip>
        </div>
        <UnreadBadge feedId={feedId} tick={tick} />
      </div>
    </li>
  );
}

function SidebarFolderItem({
  folder,
  feeds,
  selectedIds,
  onToggleFeed,
  onRenameFeed,
  onRemoveFeed,
  onRenameFolder,
  onRemoveFolder,
  onToggleCollapsed,
  tick,
}: {
  folder: FolderInfo;
  feeds: FeedInfo[];
  selectedIds: string[];
  onToggleFeed: (id: string) => void;
  onRenameFeed: (id: string, title: string) => void;
  onRemoveFeed: (id: string) => void;
  onRenameFolder: (id: string, title: string) => void;
  onRemoveFolder: (id: string) => void;
  onToggleCollapsed: (id: string) => void;
  tick: number;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(folder.title);
  useEffect(() => setValue(folder.title), [folder.title]);

  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: `folder:${folder.id}` });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  } as React.CSSProperties;

  const feedMap = new Map(feeds.map((f) => [f.id, f] as const));
  const itemsInFolder = folder.feedIds.map((fid) => feedMap.get(fid)).filter((x): x is FeedInfo => !!x);

  return (
    <li ref={setNodeRef} style={style} className="group/folder">
      <div
        className={cn(
          "flex items-center gap-2 px-2 py-2 rounded cursor-pointer border",
          "border-transparent hover:bg-muted/50"
        )}
        onClick={() => onToggleCollapsed(folder.id)}
        role="button"
        aria-expanded={!folder.collapsed}
      >
        <span className="relative shrink-0 h-5 w-5" onClick={(e) => e.stopPropagation()} aria-label="Dossier">
          <Folder className="h-5 w-5 text-muted-foreground transition-opacity group-hover/folder:opacity-0" />
          <span
            className="absolute inset-0 grid place-items-center opacity-0 group-hover/folder:opacity-100 text-muted-foreground cursor-grab active:cursor-grabbing"
            {...attributes}
            {...listeners}
          >
            <GripVertical size={14} />
          </span>
        </span>
        {editing ? (
          <input
            className="bg-transparent outline-none flex-1 min-w-0"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onRenameFolder(folder.id, value.trim() || folder.title);
                setEditing(false);
              }
              if (e.key === "Escape") setEditing(false);
            }}
            onBlur={() => {
              onRenameFolder(folder.id, value.trim() || folder.title);
              setEditing(false);
            }}
            autoFocus
          />
        ) : (
          <span
            className="flex-1 min-w-0 truncate text-sm"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setEditing(true);
            }}
          >
            {folder.title}
          </span>
        )}
        <div className="ml-2 flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1.5 opacity-0 group-hover/folder:opacity-100 transition-opacity">
            <button className="p-1 rounded hover:bg-foreground/5" onClick={() => setEditing(true)} aria-label="Renommer le dossier">
              <Pencil size={16} />
            </button>
            <button className="p-1 rounded hover:bg-foreground/5" onClick={() => onRemoveFolder(folder.id)} aria-label="Supprimer le dossier">
              <Trash2 size={16} />
            </button>
          </div>
          <button
            className="p-1 rounded hover:bg-foreground/5"
            onClick={() => onToggleCollapsed(folder.id)}
            aria-label={folder.collapsed ? "Déplier" : "Replier"}
          >
            {folder.collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>
      {!folder.collapsed && itemsInFolder.length > 0 && (
        <ul className="mt-1 space-y-1">
          <SortableContext items={itemsInFolder.map((f) => `feed:${f.id}`)} strategy={verticalListSortingStrategy}>
            {itemsInFolder.map((f) => (
              <SidebarItem
                key={f.id}
                id={`feed:${f.id}`}
                feedId={f.id}
                title={f.title}
                url={f.url}
                selected={selectedIds.includes(f.id)}
                onToggle={() => onToggleFeed(f.id)}
                onRemove={() => onRemoveFeed(f.id)}
                onRename={(t) => onRenameFeed(f.id, t)}
                tick={tick}
              />
            ))}
          </SortableContext>
        </ul>
      )}
    </li>
  );
}

function UnreadBadge({ feedId, tick }: { feedId: string; tick: number }) {
  const [count, setCount] = useState<number>(0);
  const [url, setUrl] = useState<string>("");
  useEffect(() => {
    // Lookup URL and compute count
    const stored = localStorage.getItem("flux:feeds");
    if (stored) {
      try {
        const arr = JSON.parse(stored) as { id: string; url: string }[];
        const f = arr.find((x) => x.id === feedId);
        if (f) {
          setUrl(f.url);
          setCount(countUnreadToday(f.url));
        }
      } catch {}
    }
  }, [feedId, tick]);

  if (!url || count <= 0) return null;
  return (
    <span className="ml-1 shrink-0 inline-flex items-center justify-center rounded-full bg-foreground/10 text-foreground text-[11px] px-1.5 py-0.5">
      {count}
    </span>
  );
}

function Favicon({ url, className }: { url: string; className?: string }) {
  const [ok, setOk] = useState(true);
  const src = getFaviconUrl(url);
  if (!ok) return <span className="block h-5 w-5 rounded-sm bg-foreground/10" />;
  return (
    <img
      src={src}
      alt=""
      className={cn("block h-5 w-5 rounded-sm object-contain", className)}
      onError={() => setOk(false)}
    />
  );
}

function getFaviconUrl(u: string): string {
  try {
    const { hostname } = new URL(u);
    return `https://icons.duckduckgo.com/ip3/${hostname}.ico`;
  } catch {
    return "";
  }
}

function CollapsedItem({ id, url, selected, onToggle }: { id: string; url: string; selected: boolean; onToggle: () => void }) {
  return (
    <li
      className={cn(
        "group flex items-center justify-center p-1 rounded cursor-pointer transition-opacity",
        selected ? "opacity-100 bg-secondary" : "opacity-50 hover:opacity-100 hover:bg-muted/50"
      )}
      onClick={onToggle}
      title={url}
    >
      <Favicon url={url} />
    </li>
  );
}



