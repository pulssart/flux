import * as cheerio from "cheerio";

const IMAGE_SELECTORS = [
  // Open Graph
  'meta[property="og:image"]',
  'meta[name="og:image"]',
  'meta[property="og:image:secure_url"]',
  // Twitter
  'meta[name="twitter:image"]',
  'meta[name="twitter:image:src"]',
  // Schema.org
  'meta[itemprop="image"]',
  // Article specific
  'meta[property="article:image"]',
  'meta[name="article:image"]',
  // RSS specific
  'link[rel="image_src"]',
  // Apple
  'meta[name="apple-touch-startup-image"]',
];

const CONTENT_SELECTORS = [
  // Article containers
  "article img",
  ".post-content img",
  ".entry-content img",
  ".article-content img",
  ".content img",
  // Featured images
  ".featured-image img",
  ".post-thumbnail img",
  ".hero-image img",
  // Fallbacks
  "main img",
  "#content img",
];

const IGNORED_DOMAINS = [
  "google-analytics.com",
  "doubleclick.net",
  "facebook.com",
  "twitter.com",
  "linkedin.com",
];

const MIN_IMAGE_SIZE = 100; // Minimum width/height in pixels

interface ImageInfo {
  url: string;
  width?: number;
  height?: number;
  alt?: string;
}

export async function extractBestImage(url: string, html?: string, timeoutMs = 5000): Promise<string | null> {
  try {
    // Si le HTML n'est pas fourni, le récupérer
    if (!html) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { "user-agent": "FluxRSS/1.0" }
        });
        if (!res.ok) return null;
        html = await res.text();
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    }

    const $ = cheerio.load(html);
    const images: ImageInfo[] = [];

    // 1. Chercher les méta-images (OG, Twitter, etc.)
    for (const selector of IMAGE_SELECTORS) {
      const content = $(selector).attr("content") || $(selector).attr("href");
      if (content) {
        try {
          const absoluteUrl = new URL(content, url).toString();
          if (!IGNORED_DOMAINS.some(domain => absoluteUrl.includes(domain))) {
            images.push({ url: absoluteUrl });
          }
        } catch {}
      }
    }

    // 2. Chercher les images dans le contenu
    for (const selector of CONTENT_SELECTORS) {
      $(selector).each((_, el) => {
        const $img = $(el);
        const src = $img.attr("src");
        if (src) {
          try {
            const absoluteUrl = new URL(src, url).toString();
            if (!IGNORED_DOMAINS.some(domain => absoluteUrl.includes(domain))) {
              const width = parseInt($img.attr("width") || "0", 10);
              const height = parseInt($img.attr("height") || "0", 10);
              const alt = $img.attr("alt");
              
              // Ignorer les petites images
              if (width && height && (width < MIN_IMAGE_SIZE || height < MIN_IMAGE_SIZE)) {
                return;
              }
              
              // Ignorer les images probablement décoratives
              if (src.includes("icon") || src.includes("logo") || src.includes("avatar")) {
                return;
              }

              images.push({ url: absoluteUrl, width, height, alt });
            }
          } catch {}
        }
      });
    }

    // 3. Trier les images par pertinence
    const sortedImages = images
      .filter(img => {
        const url = img.url.toLowerCase();
        // Filtrer les images non pertinentes
        return !url.includes("tracking") &&
               !url.includes("pixel") &&
               !url.includes("advertisement") &&
               !url.endsWith(".svg");
      })
      .sort((a, b) => {
        // Prioriser les images avec dimensions
        if (a.width && a.height && (!b.width || !b.height)) return -1;
        if (b.width && b.height && (!a.width || !a.height)) return 1;
        
        // Prioriser les images avec alt text pertinent
        if (a.alt && !b.alt) return -1;
        if (b.alt && !a.alt) return 1;

        return 0;
      });

    return sortedImages[0]?.url || null;
  } catch {
    return null;
  }
}

// Fallback: Utiliser l'API DuckDuckGo pour obtenir une icône de site
export function getFaviconUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    return `https://icons.duckduckgo.com/ip3/${hostname}.ico`;
  } catch {
    return "";
  }
}
