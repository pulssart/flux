export type CachedItem = {
  id: string;
  title: string;
  link?: string;
  pubDate?: string;
  contentSnippet?: string;
  image?: string;
  source?: string; // feed url
};

const FEED_CACHE_PREFIX = "flux:feed-cache:";
const IMAGE_CACHE_NAME = "flux-images";
const LAST_OPEN_PREFIX = "flux:last-open:";
const MAX_ITEMS_PER_FEED = 500;
const ITEM_TTL_DAYS = 30; // purge au-delà de 30 jours
const IMAGE_CACHE_MAX_PER_FEED = 200; // LRU images par flux

function keyFor(feedUrl: string): string {
  return FEED_CACHE_PREFIX + feedUrl;
}

export function saveFeedItemsToCache(feedUrl: string, items: CachedItem[]): void {
  try {
    // Fusionner avec l'existant pour augmenter la rétention et éviter les doublons
    const existing = loadFeedItemsFromCache(feedUrl);
    const byId = new Map<string, CachedItem>();
    for (const it of existing) byId.set(it.id, it);
    for (const it of items) byId.set(it.id, it);
    const merged = Array.from(byId.values());
    // Trier par date la plus récente
    merged.sort((a, b) => getItemDateMs(b) - getItemDateMs(a));
    // Purger items trop anciens selon TTL
    const now = Date.now();
    const ttlMs = ITEM_TTL_DAYS * 24 * 60 * 60 * 1000;
    const fresh = merged.filter((i) => {
      const t = getItemDateMs(i);
      // Conserver si pas de date ou si dans le TTL
      return t === 0 || now - t <= ttlMs;
    });
    // Limiter pour rester dans la taille raisonnable de localStorage
    const limited = fresh.slice(0, MAX_ITEMS_PER_FEED);

    const payload = { savedAt: Date.now(), items: limited } as const;
    localStorage.setItem(keyFor(feedUrl), JSON.stringify(payload));
  } catch {}
}

export function loadFeedItemsFromCache(feedUrl: string): CachedItem[] {
  try {
    const str = localStorage.getItem(keyFor(feedUrl));
    if (!str) return [];
    const obj = JSON.parse(str) as { savedAt: number; items: CachedItem[] };
    return Array.isArray(obj.items) ? obj.items : [];
  } catch {
    return [];
  }
}

export function clearFeedCache(feedUrl: string): void {
  try {
    localStorage.removeItem(keyFor(feedUrl));
    localStorage.removeItem(lastOpenKey(feedUrl));
  } catch {}
}

export async function cacheImagesForItems(items: CachedItem[]): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    const cache = await caches.open(IMAGE_CACHE_NAME);
    const urls = Array.from(new Set(items.map((i) => i.image).filter(Boolean) as string[]));
    await Promise.all(
      urls.map(async (u) => {
        try {
          const req = new Request(u, { mode: "no-cors" });
          const res = await fetch(req).catch(() => null);
          if (res) await cache.put(req, res.clone());
        } catch {}
      })
    );
  } catch {}
}

// Cache d'images par flux avec purge LRU via manifeste localStorage
export async function cacheImagesForFeed(feedUrl: string, items: CachedItem[]): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    const urls = Array.from(new Set(items.map((i) => i.image).filter(Boolean) as string[]));
    if (!urls.length) return;
    const cache = await caches.open(IMAGE_CACHE_NAME);

    const key = imageManifestKey(feedUrl);
    const manifest = loadImageManifest(key);
    const now = Date.now();

    // Marquer comme récemment utilisés et ajouter les nouveaux
    for (const u of urls) {
      const idx = manifest.findIndex((m) => m.url === u);
      if (idx >= 0) {
        manifest[idx].savedAt = now;
      } else {
        manifest.push({ url: u, savedAt: now });
      }
    }

    // Précharger / rafraîchir les nouvelles images
    await Promise.all(
      urls.map(async (u) => {
        try {
          const req = new Request(u, { mode: "no-cors" });
          const res = await fetch(req).catch(() => null);
          if (res) await cache.put(req, res.clone());
        } catch {}
      })
    );

    // Ordonner par recenteté (savedAt desc)
    manifest.sort((a, b) => b.savedAt - a.savedAt);

    // Purger le surplus
    const toDelete = manifest.slice(IMAGE_CACHE_MAX_PER_FEED);
    for (const entry of toDelete) {
      try {
        const req = new Request(entry.url, { mode: "no-cors" });
        await cache.delete(req, { ignoreVary: true, ignoreSearch: false });
      } catch {}
    }

    const limited = manifest.slice(0, IMAGE_CACHE_MAX_PER_FEED);
    saveImageManifest(key, limited);
  } catch {}
}

export async function clearImageCacheForFeed(feedUrl: string): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    const items = loadFeedItemsFromCache(feedUrl);
    if (!items.length) return;
    const cache = await caches.open(IMAGE_CACHE_NAME);
    await Promise.all(
      items
        .map((i) => i.image)
        .filter((u): u is string => !!u)
        .map(async (u) => {
          try {
            const req = new Request(u, { mode: "no-cors" });
            await cache.delete(req, { ignoreVary: true, ignoreSearch: false });
          } catch {}
        })
    );
  } catch {}
}

export function countUnreadToday(feedUrl: string): number {
  const items = loadFeedItemsFromCache(feedUrl);
  const today = todayYmd();
  if (wasFeedOpenedToday(feedUrl)) return 0;
  return items.filter((i) => (i.pubDate ? ymd(i.pubDate) === today : false)).length;
}

export function markFeedOpenedToday(feedUrl: string): void {
  try {
    localStorage.setItem(lastOpenKey(feedUrl), todayYmd());
  } catch {}
}

export function wasFeedOpenedToday(feedUrl: string): boolean {
  try {
    const v = localStorage.getItem(lastOpenKey(feedUrl));
    return v === todayYmd();
  } catch {
    return false;
  }
}

function lastOpenKey(feedUrl: string): string {
  return LAST_OPEN_PREFIX + encodeURIComponent(feedUrl);
}

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function ymd(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getItemDateMs(item: { pubDate?: string }): number {
  if (!item.pubDate) return 0;
  const t = +new Date(item.pubDate);
  return Number.isFinite(t) ? t : 0;
}

type ImageManifestEntry = { url: string; savedAt: number };
function imageManifestKey(feedUrl: string): string {
  return `flux:image-manifest:${encodeURIComponent(feedUrl)}`;
}
function loadImageManifest(key: string): ImageManifestEntry[] {
  try {
    const str = localStorage.getItem(key);
    if (!str) return [];
    const arr = JSON.parse(str) as ImageManifestEntry[];
    return Array.isArray(arr) ? arr.filter((x) => x && typeof x.url === "string" && typeof x.savedAt === "number") : [];
  } catch {
    return [];
  }
}
function saveImageManifest(key: string, manifest: ImageManifestEntry[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(manifest));
  } catch {}
}


