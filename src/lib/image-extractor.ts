import * as cheerio from "cheerio";

const IMAGE_SELECTORS = [
  // Open Graph (plus fiable)
  'meta[property="og:image:secure_url"]',
  'meta[property="og:image"]',
  'meta[name="og:image"]',
  // Twitter Cards (souvent haute qualité)
  'meta[name="twitter:image:src"]',
  'meta[name="twitter:image"]',
  'meta[name="twitter:image:large"]',
  // Schema.org et autres standards
  'meta[itemprop="image"]',
  'meta[property="article:image"]',
  'meta[name="article:image"]',
  'meta[name="thumbnail"]',
  // RSS et autres
  'link[rel="image_src"]',
  'link[rel="apple-touch-icon"]',
  'link[rel="icon"]',
];

const CONTENT_SELECTORS = [
  // Images mises en avant
  ".featured-image img",
  ".post-thumbnail img",
  ".hero-image img",
  ".wp-post-image",
  // Conteneurs d'articles
  "article img:first-of-type",
  ".post-content img:first-of-type",
  ".entry-content img:first-of-type",
  ".article-content img:first-of-type",
  ".article__content img:first-of-type",
  ".post__content img:first-of-type",
  // Conteneurs génériques
  ".content img:first-of-type",
  "main img:first-of-type",
  "#content img:first-of-type",
  // Fallback: première image de la page
  "img:first-of-type",
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
          headers: { 
            "user-agent": "Mozilla/5.0 (compatible; FluxRSS/1.0; +https://flux-rss.com)",
            "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "accept-language": "en-US,en;q=0.5"
          }
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
      const $el = $(selector);
      const content = $el.attr("content") || $el.attr("href");
      if (content) {
        try {
          let absoluteUrl = content;
          // Gérer les URLs relatives et protocol-relative
          if (content.startsWith("//")) {
            absoluteUrl = `https:${content}`;
          } else if (!content.startsWith("http")) {
            absoluteUrl = new URL(content, url).toString();
          }
          
          if (!IGNORED_DOMAINS.some(domain => absoluteUrl.includes(domain))) {
            // Extraire les dimensions des méta-tags si disponibles
            const width = parseInt($el.attr("width") || $el.attr("content-width") || "0", 10);
            const height = parseInt($el.attr("height") || $el.attr("content-height") || "0", 10);
            images.push({ 
              url: absoluteUrl,
              width,
              height,
              alt: $el.attr("alt") || $el.attr("title") || ""
            });
          }
        } catch {}
      }
    }

    // 2. Chercher les images dans le contenu
    for (const selector of CONTENT_SELECTORS) {
      $(selector).each((_, el) => {
        const $img = $(el);
        const src = $img.attr("src") || $img.attr("data-src") || $img.attr("data-lazy-src");
        if (src) {
          try {
            let absoluteUrl = src;
            if (src.startsWith("//")) {
              absoluteUrl = `https:${src}`;
            } else if (!src.startsWith("http")) {
              absoluteUrl = new URL(src, url).toString();
            }

            if (!IGNORED_DOMAINS.some(domain => absoluteUrl.includes(domain))) {
              // Vérifier d'abord les attributs width/height
              let width = parseInt($img.attr("width") || "0", 10);
              let height = parseInt($img.attr("height") || "0", 10);
              
              // Si pas de dimensions dans les attributs, chercher dans le style
              if (!width || !height) {
                const style = $img.attr("style") || "";
                const widthMatch = style.match(/width:\s*(\d+)px/);
                const heightMatch = style.match(/height:\s*(\d+)px/);
                if (widthMatch) width = parseInt(widthMatch[1], 10);
                if (heightMatch) height = parseInt(heightMatch[1], 10);
              }
              
              // Vérifier aussi data-width/data-height
              if (!width) width = parseInt($img.attr("data-width") || "0", 10);
              if (!height) height = parseInt($img.attr("data-height") || "0", 10);
              
              const alt = $img.attr("alt") || $img.attr("title") || "";
              
              // Ignorer les petites images seulement si on a les dimensions
              if ((width || height) && (width < MIN_IMAGE_SIZE && height < MIN_IMAGE_SIZE)) {
                return;
              }
              
              // Ignorer les images probablement décoratives
              const urlLower = absoluteUrl.toLowerCase();
              if (
                urlLower.includes("icon") || 
                urlLower.includes("logo") || 
                urlLower.includes("avatar") ||
                urlLower.includes("badge") ||
                urlLower.includes("button") ||
                /\b1x1\b/.test(urlLower)
              ) {
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
               !url.includes("banner") &&
               !url.includes("analytics") &&
               !url.includes("spacer") &&
               !url.endsWith(".svg") &&
               !url.endsWith(".gif");
      })
      .sort((a, b) => {
        // Prioriser les images avec dimensions correctes
        const aHasSize = (a.width || 0) > MIN_IMAGE_SIZE || (a.height || 0) > MIN_IMAGE_SIZE;
        const bHasSize = (b.width || 0) > MIN_IMAGE_SIZE || (b.height || 0) > MIN_IMAGE_SIZE;
        if (aHasSize && !bHasSize) return -1;
        if (bHasSize && !aHasSize) return 1;
        
        // Prioriser les images avec alt text pertinent
        const aHasAlt = !!a.alt && a.alt.length > 5;
        const bHasAlt = !!b.alt && b.alt.length > 5;
        if (aHasAlt && !bHasAlt) return -1;
        if (bHasAlt && !aHasAlt) return 1;

        // En dernier recours, prioriser les URLs qui semblent être des images d'article
        const aIsArticleImg = /\b(article|post|feature|hero|thumbnail)\b/.test(a.url.toLowerCase());
        const bIsArticleImg = /\b(article|post|feature|hero|thumbnail)\b/.test(b.url.toLowerCase());
        if (aIsArticleImg && !bIsArticleImg) return -1;
        if (bIsArticleImg && !aIsArticleImg) return 1;

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
