import Parser from "rss-parser";
import * as cheerio from "cheerio";

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
};

export async function parseFeed(url: string, opts?: ParseFeedOptions): Promise<ParsedFeed> {
  const now = Date.now();
  const isFast = opts?.fast === true;
  const maxItems = typeof opts?.maxItems === "number" && opts!.maxItems! > 0 ? Math.floor(opts!.maxItems!) : (isFast ? 20 : 60);
  const enrichOg = typeof opts?.enrichOg === "boolean" ? opts.enrichOg : !isFast;
  const timeoutMs = typeof opts?.timeoutMs === "number" && opts!.timeoutMs! > 0 ? Math.floor(opts!.timeoutMs!) : (isFast ? 4000 : 10000);
  const ALWAYS_OG_HOSTS = [
    "lemonde.fr",
    "nytimes.com",
    "bbc.com",
    "ft.com",
    "lefigaro.fr",
    "techcrunch.com",
  ]; // rapide OG même en fast (inclut TechCrunch)

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

      // Fallback final: image thématique via Unsplash (basée sur un mot‑clé optimisé)
      if (!image) {
        const baseTitle = (item.title || "").toString().trim();
        const baseSnippet = (item.contentSnippet || "").toString().trim();
        const kw = await generateUnsplashKeyword(baseTitle, baseSnippet, Math.min(1200, timeoutMs)).catch(() => null);
        const q = (kw || baseTitle).trim();
        if (q) {
          const u = await findUnsplashImage(q, Math.min(2500, timeoutMs)).catch(() => null);
          if (u) image = u;
        }
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
  // Collecte de candidats potentiels (URLs d'images)
  const candidates: string[] = [];
  // Prioritaire: WordPress featured image
  try {
    // Certaines pages utilisent <a class="wp-block-post-featured-image"><img ...> ou un lien direct vers l'image
    let heroImage: string | null = null;
    const featured = $(".wp-block-post-featured-image img, .wp-post-image, .post-thumbnail img, .featured-image img").first();
    if (!featured || !featured.length) {
      const linkWrap = $(".wp-block-post-featured-image a").first();
      if (linkWrap && linkWrap.length) {
        const href = linkWrap.attr("href");
        if (href && /\.(jpg|jpeg|png|webp|gif)(?:\?|$)/i.test(href)) {
          heroImage = resolveUrl(href, baseLink);
        }
      }
    }
    if (!heroImage && featured && featured.length) {
      const attrs = [
        featured.attr("src"),
        featured.attr("data-src"),
        featured.attr("data-lazy-src"),
        featured.attr("data-original"),
        featured.attr("data-image"),
        featured.attr("data-actualsrc"),
        featured.attr("data-src-large"),
      ].filter(Boolean) as string[];
      const srcset = pickBestFromSrcset(featured.attr("srcset") || featured.attr("data-srcset") || null);
      if (srcset) attrs.push(srcset);
      const src = attrs.find(Boolean) || null;
      const normalized = normalizeImageUrl(src);
      if (normalized) heroImage = resolveUrl(normalized, baseLink);
    }
    if (heroImage) return heroImage;
  } catch {}
  // Sources <source media=...> en début de post (fréquent dans des heros responsive)
  try {
    $("source[media][srcset], source[media][data-srcset]")
      .slice(0, 8)
      .each((_, el) => {
        const $el = $(el);
        const best = pickBestFromSrcset($el.attr("srcset") || $el.attr("data-srcset") || null);
        if (best) candidates.push(best);
      });
  } catch {}

  // Essayer differents attributs et variantes lazy
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

    // 1) Essayer d'abord de scrapper une image "héros" dans le contenu (priorité)
    const pickFrom = ($el: ReturnType<typeof $>) => {
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
      const src = attrs.find(Boolean) || null;
      return src ? resolveUrl(src, link) : null;
    };
    let heroImage: string | null = null;
    try {
      const heroSel = ".wp-block-post-featured-image img, .wp-post-image, .post-thumbnail img, .featured-image img, figure.wp-block-image img, article img:first-of-type, main img:first-of-type";
      const hero = $(heroSel).first();
      if (hero && hero.length) heroImage = pickFrom(hero);
      if (!heroImage) {
        const sourceBest = pickBestFromSrcset($("source[media][srcset], source[media][data-srcset]").first().attr("srcset") || null);
        if (sourceBest) heroImage = resolveUrl(sourceBest, link);
      }
    } catch {}

    // 2) Métadonnées OG/Twitter (secondaire)
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
      // Priorité au scrapping direct (héros), sinon OG
      image: heroImage || (ogImage ? resolveUrl(ogImage, link) : null),
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


// --- Unsplash fallback ---
type UnsplashCacheEntry = { savedAt: number; url: string | null };
const UNSPLASH_CACHE = new Map<string, UnsplashCacheEntry>();
const UNSPLASH_TTL_MS = 24 * 60 * 60 * 1000; // 24h

async function findUnsplashImage(query: string, timeoutMs = 2500): Promise<string | null> {
  try {
    const q = query
      .toLowerCase()
      .replace(/[:|–—\-]+/g, " ")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 140);
    const cached = UNSPLASH_CACHE.get(q);
    const now = Date.now();
    if (cached && now - cached.savedAt < UNSPLASH_TTL_MS) {
      return cached.url;
    }

    const key = (process.env.UNSPLASH_ACCESS_KEY || process.env.NEXT_PUBLIC_UNSPLASH_KEY || "").toString().trim();
    if (key) {
      const url = new URL("https://api.unsplash.com/search/photos");
      url.searchParams.set("query", q);
      url.searchParams.set("orientation", "landscape");
      url.searchParams.set("content_filter", "high");
      url.searchParams.set("per_page", "1");
      url.searchParams.set("page", "1");

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Accept-Version": "v1",
          Authorization: `Client-ID ${key}`,
        },
        signal: controller.signal,
      }).catch(() => null);
      clearTimeout(timer);
      if (res && res.ok) {
        const data = (await res.json()) as { results?: Array<{ urls?: { regular?: string; small?: string; thumb?: string } }> };
        const first = (data.results || [])[0];
        const chosen = first?.urls?.regular || first?.urls?.small || first?.urls?.thumb || null;
        if (chosen) {
          UNSPLASH_CACHE.set(q, { savedAt: now, url: chosen });
          return chosen;
        }
      }
    }

    // Fallback sans clé: utiliser Picsum (pas de quota) avec seed déterministe
    const seed = encodeURIComponent(q || "news");
    const picsum = `https://picsum.photos/seed/${seed}/1200/630`;
    UNSPLASH_CACHE.set(q, { savedAt: now, url: picsum });
    return picsum;
  } catch {
    return null;
  }
}

// Génération ultra‑légère d’un mot‑clé Unsplash pertinent à partir du titre/snippet
async function generateUnsplashKeyword(title: string, snippet?: string, timeoutMs = 1200): Promise<string | null> {
  try {
    const apiKey = (process.env.OPENAI_API_KEY || "").toString().trim();
    if (!apiKey) return null;
    const t = (title || "").slice(0, 120);
    const s = (snippet || "").slice(0, 140);
    const prompt =
      "You are selecting a minimal Unsplash search query. From the news title and optional snippet, output 1-3 concise English keywords (nouns), lowercase, no punctuation, max 3 words, best representing the visual topic. Reply with keywords only.\n\n" +
      `title: ${t}\nsnippet: ${s}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response | null = null;
    try {
      res = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model: "gpt-5-nano", input: prompt }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res || !res.ok) return null;
    const json = (await res.json()) as unknown;
    const text = extractTextFromMini(json);
    return (text || "").toString().trim().toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").slice(0, 60) || null;
  } catch {
    return null;
  }
}

function extractTextFromMini(json: unknown): string {
  if (!json || typeof json !== "object") return "";
  const outputText = (json as { output_text?: unknown }).output_text;
  if (typeof outputText === "string" && outputText.trim()) return outputText;
  const outputArr = Array.isArray((json as { output?: unknown }).output)
    ? ((json as { output?: unknown }).output as unknown[])
    : [];
  for (const o of outputArr) {
    const content = Array.isArray((o as { content?: unknown }).content)
      ? ((o as { content?: unknown }).content as unknown[])
      : [];
    for (const c of content) {
      const cText = (c as { text?: unknown }).text;
      if (typeof cText === "string" && cText.trim()) return cText;
    }
  }
  return "";
}


