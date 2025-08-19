import Parser from "rss-parser";
import * as cheerio from "cheerio";
import { getUnsplashImage } from "./unsplash";

export type ParsedEnclosure = {
  url?: string;
  type?: string;
};

export type ParsedItem = {
  id: string;
  title: string;
  link?: string;
  pubDate?: string;
  contentSnippet?: string;
  image?: string;
  enclosure?: ParsedEnclosure;
};

export type ParsedFeed = {
  title?: string;
  link?: string;
  items: ParsedItem[];
};

// Cache mémoire côté serveur pour réduire la charge réseau
const FEED_SSR_TTL_MS = 30 * 60 * 1000; // 30 min
const FEED_SSR_STALE_MAX_MS = 6 * 60 * 60 * 1000; // 6 h (fallback si erreur)
type FeedCacheEntry = { savedAt: number; data: ParsedFeed };
const feedCache = new Map<string, FeedCacheEntry>();

const parser = new Parser({
  timeout: 10000,
  // RSS/Atom/Generic XML support is handled by rss-parser internally
});

type ParseFeedOptions = {
  fast?: boolean;
  maxItems?: number;
  timeoutMs?: number;
  enrichOg?: boolean; // for advanced control; overrides fast behavior
  unsplashKey?: string; // clé API Unsplash pour les images de fallback
};

export async function parseFeed(url: string, opts?: ParseFeedOptions): Promise<ParsedFeed> {
  const now = Date.now();
  const isFast = opts?.fast === true;
  const maxItems = typeof opts?.maxItems === "number" && opts!.maxItems! > 0 ? Math.floor(opts!.maxItems!) : (isFast ? 20 : 60);
  const enrichOg = typeof opts?.enrichOg === "boolean" ? opts.enrichOg : !isFast;
  const timeoutMs = typeof opts?.timeoutMs === "number" && opts!.timeoutMs! > 0 ? Math.floor(opts!.timeoutMs!) : (isFast ? 4000 : 10000);
  const ALWAYS_OG_HOSTS = ["lemonde.fr", "nytimes.com", "bbc.com", "ft.com", "lefigaro.fr"]; // rapide OG même en fast

  const cacheKey = `${url}#${isFast ? "fast" : "full"}#${maxItems}`;
  const cached = feedCache.get(cacheKey);
  if (cached && now - cached.savedAt < FEED_SSR_TTL_MS) {
    return cached.data;
  }

  let feed;
  try {
    const parserUsed = timeoutMs !== 10000 ? new Parser({ timeout: timeoutMs }) : parser;
    feed = await parserUsed.parseURL(url);
  } catch (err) {
    if (cached && now - cached.savedAt < FEED_SSR_STALE_MAX_MS) {
      // Fallback en cas d'erreur: retourner des données un peu plus anciennes
      return cached.data;
    }
    throw err;
  }

  const rawItems = (feed.items || []).slice(0, maxItems);
  const enrichedItems: ParsedItem[] = await Promise.all(
    rawItems.map(async (item, index) => {
      const anyItem = item as Record<string, unknown>;
      const html = (anyItem["content:encoded"] as string | undefined) || (anyItem.content as string | undefined) || "";

      let image =
        extractImageFromHtml(html, item.link) ||
        extractImageFromEnclosure(item) ||
        extractImageFromMedia(anyItem) ||
        extractImageFromItunes(anyItem);

      let ogMeta: OgMetadata | null = null;
      if (enrichOg) {
        if (!image && item.link) {
          ogMeta = await fetchOgMetadata(item.link).catch(() => null);
          image = ogMeta?.image || null;
        }
      } else if (!image && item.link) {
        // Fast mode: OG rapide pour quelques hôtes connus
        try {
          const host = new URL(item.link).hostname.replace(/^www\./, "");
          if (ALWAYS_OG_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
            ogMeta = await fetchOgMetadata(item.link, Math.min(2000, timeoutMs)).catch(() => null);
            image = ogMeta?.image || image || null;
          }
        } catch {}
      }

      // Fallback spécifique YouTube: construire l'URL de miniature si nécessaire
      if (!image && item.link) {
        const yt = youtubeThumbnailFromLink(item.link);
        if (yt) image = yt;
      }

      // Fallback Unsplash: utiliser une image basée sur le titre de l'article
      if (!image && !isFast && opts?.unsplashKey) {
        try {
          const keywords = item.title
            .split(/[\s,.-]+/) // Séparer sur les espaces et la ponctuation
            .filter(w => w.length > 3) // Garder les mots significatifs
            .slice(0, 3) // Prendre les 3 premiers mots
            .join(" ");
          image = await getUnsplashImage(keywords, opts.unsplashKey);
        } catch {}
      }

      const id = (item.guid as string) || `${item.link || ""}#${index}`;

      // Build description/snippet with robust fallbacks (e.g., Product Hunt)
      let snippet = item.contentSnippet || stripHtml(html).slice(0, 240);
      if (enrichOg) {
        try {
          const linkHost = item.link ? new URL(item.link).hostname : "";
          const needsEnhance = !snippet || snippet.length < 30 || /producthunt\.com$/.test(linkHost) || /(^|\.)producthunt\.com$/.test(linkHost);
          if (needsEnhance && item.link) {
            if (!ogMeta) ogMeta = await fetchOgMetadata(item.link).catch(() => null);
            const ogDesc = ogMeta?.description || "";
            if (ogDesc && ogDesc.length > (snippet?.length || 0)) {
              snippet = ogDesc.slice(0, 280).trim();
            } else if (!snippet) {
              // fallback to first paragraph from the fetched HTML
              const para = ogMeta?.firstParagraph;
              if (para) snippet = para.slice(0, 280).trim();
            }
          }
        } catch {}
      }

      return {
        id,
        title: item.title || "Sans titre",
        link: item.link,
        pubDate: item.isoDate || (item.pubDate as string) || undefined,
        contentSnippet: snippet,
        image: image || undefined,
        enclosure: item.enclosure as ParsedEnclosure | undefined,
      };
    })
  );

  const result: ParsedFeed = {
    title: feed.title,
    link: feed.link,
    items: enrichedItems,
  };

  // Mettre en cache la réponse enrichie
  feedCache.set(cacheKey, { savedAt: Date.now(), data: result });

  return result;
}

function pickBestFromSrcset(srcset?: string | null): string | null {
  if (!srcset) return null;
  const parts = srcset.split(",").map((s) => s.trim()).filter(Boolean);
  let best: { url: string; width: number } | null = null;
  for (const p of parts) {
    const segs = p.split(/\s+/);
    const url = segs[0];
    const wSeg = segs.find((s) => /\d+w$/.test(s));
    const w = wSeg ? parseInt(wSeg.replace(/\D+/g, ""), 10) : 0;
    if (!best || w > best.width) best = { url, width: w };
  }
  return best?.url || null;
}

function normalizeImageUrl(u?: string | null): string | null {
  if (!u) return null;
  if (u.startsWith("//")) return "https:" + u;
  return u;
}

function extractImageFromHtml(html: string, baseLink?: string): string | null {
  if (!html) return null;
  const $ = cheerio.load(html);
  // Essayer differents attributs et variantes lazy
  const candidates: string[] = [];
  $("img").each((_, el) => {
    const $el = $(el);
    const attrs = [
      $el.attr("src"),
      $el.attr("data-src"),
      $el.attr("data-lazy-src"),
      $el.attr("data-original"),
      $el.attr("data-image"),
      $el.attr("data-actualsrc"),
      $el.attr("data-src-large"),
    ].filter(Boolean) as string[];
    const srcset = pickBestFromSrcset($el.attr("srcset") || $el.attr("data-srcset") || null);
    if (srcset) attrs.push(srcset);
    candidates.push(...attrs);
  });
  // Prendre aussi <source srcset> dans <picture>
  $("picture source").each((_, el) => {
    const $el = $(el);
    const srcset = pickBestFromSrcset($el.attr("srcset") || null);
    if (srcset) candidates.push(srcset);
  });
  const src = candidates.find(Boolean) || null;
  const normalized = normalizeImageUrl(src);
  return normalized ? resolveUrl(normalized, baseLink) : null;
}

type RssParserItem = {
  enclosure?: ParsedEnclosure;
};

function extractImageFromEnclosure(item: RssParserItem): string | null {
  const enc = item.enclosure as ParsedEnclosure | undefined;
  if (enc?.url && (enc.type?.startsWith("image/") || enc.type === undefined)) {
    return enc.url;
  }
  return null;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function extractImageFromMedia(anyItem: Record<string, unknown>): string | null {
  const mediaContent = anyItem["media:content"] as unknown;
  const mediaThumb = anyItem["media:thumbnail"] as unknown;
  const itunesImage = anyItem["itunes:image"] as unknown;
  const mediaGroup = anyItem["media:group"] as unknown;

  const tryGetUrl = (val: unknown): string | null => {
    if (!val) return null;
    if (typeof val === "string") return val;
    if (Array.isArray(val)) {
      for (const v of val) {
        const u = tryGetUrl(v);
        if (u) return u;
      }
      return null;
    }
    if (typeof val === "object") {
      const rec = val as Record<string, unknown>;
      const direct = rec.url;
      if (typeof direct === "string") return direct;
      const dollar = rec["$"] as Record<string, unknown> | undefined;
      const dollarUrl = dollar?.url;
      if (typeof dollarUrl === "string") return dollarUrl;
      const href = rec["href"];
      if (typeof href === "string") return href;
    }
    return null;
  };

  // Explorer aussi media:group { media:thumbnail, media:content }
  const fromGroup = ((): string | null => {
    if (!mediaGroup || typeof mediaGroup !== "object") return null;
    const grp = mediaGroup as Record<string, unknown>;
    return tryGetUrl(grp["media:thumbnail"]) || tryGetUrl(grp["media:content"]) || null;
  })();

  return tryGetUrl(mediaContent) || tryGetUrl(mediaThumb) || fromGroup || tryGetUrl(itunesImage);
}

function extractImageFromItunes(anyItem: Record<string, unknown>): string | null {
  const it = anyItem["itunes:image"] as unknown;
  if (typeof it === "object" && it) {
    const rec = it as Record<string, unknown>;
    const href = rec.href;
    if (typeof href === "string") return href;
  }
  return null;
}

export function youtubeThumbnailFromLink(link?: string): string | null {
  if (!link) return null;
  try {
    const u = new URL(link);
    const host = u.hostname.replace(/^www\./, "");
    let id = "";
    if (host === "youtu.be") {
      id = u.pathname.slice(1);
    } else if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com") || host === "m.youtube.com") {
      id = u.searchParams.get("v") || "";
      if (!id && u.pathname.startsWith("/shorts/")) id = u.pathname.split("/shorts/")[1] || "";
      if (!id && u.pathname.startsWith("/embed/")) id = u.pathname.split("/embed/")[1] || "";
    }
    if (!id) return null;
    return `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`;
  } catch {
    return null;
  }
}

type OgMetadata = { image?: string | null; description?: string | null; firstParagraph?: string | null };

async function fetchOgMetadata(link: string, timeoutMs = 3500): Promise<OgMetadata> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(link, { signal: controller.signal, headers: { "user-agent": "FluxRSS/1.0" } });
    const ct = res.headers.get("content-type") || "";
    if (!res.ok || !ct.includes("html")) return {};
    const html = await res.text();
    const $ = cheerio.load(html);

    const ogImage =
      $("meta[property='og:image']").attr("content") ||
      $("meta[name='og:image']").attr("content") ||
      $("meta[property='og:image:secure_url']").attr("content") ||
      $("meta[name='twitter:image']").attr("content") ||
      $("link[rel='image_src']").attr("href");

    const ogDesc =
      $("meta[property='og:description']").attr("content") ||
      $("meta[name='og:description']").attr("content") ||
      $("meta[name='twitter:description']").attr("content") ||
      $("meta[name='description']").attr("content") ||
      null;

    // Try JSON-LD as a last resort for description
    let ldDesc: string | null = null;
    try {
      const jsonLdRaw = $("script[type='application/ld+json']").first().text();
      if (jsonLdRaw) {
        const json = JSON.parse(jsonLdRaw);
        if (Array.isArray(json)) {
          for (const node of json) {
            if (node && typeof node === "object" && typeof node.description === "string") {
              ldDesc = node.description;
              break;
            }
          }
        } else if (json && typeof json === "object" && typeof json.description === "string") {
          ldDesc = json.description;
        }
      }
    } catch {}

    // First paragraph fallback
    const firstParagraph = $("main p").first().text().trim() || $("p").first().text().trim() || null;

    return {
      image: ogImage ? resolveUrl(ogImage, link) : null,
      description: (ogDesc || ldDesc || null)?.toString() || null,
      firstParagraph,
    };
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}

function resolveUrl(url: string, baseLink?: string): string {
  try {
    if (!baseLink) return url;
    return new URL(url, baseLink).toString();
  } catch {
    return url;
  }
}


