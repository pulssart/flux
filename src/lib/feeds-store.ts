export type FeedInfo = {
  id: string;
  title: string;
  url: string;
};

const STORAGE_KEY = "flux:feeds";

export function loadFeeds(): FeedInfo[] {
  if (typeof window === "undefined") return [];
  try {
    const str = localStorage.getItem(STORAGE_KEY);
    if (!str) return [];
    const parsed = JSON.parse(str);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p) => p && typeof p.id === "string" && typeof p.title === "string" && typeof p.url === "string");
  } catch {
    return [];
  }
}

export function saveFeeds(feeds: FeedInfo[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(feeds));
}

export function getFeedsByIds(ids: string[]): FeedInfo[] {
  const all = loadFeeds();
  const set = new Set(ids);
  return all.filter((f) => set.has(f.id));
}


