import * as cheerio from "cheerio";
import { parseFeed } from "@/lib/rss";

export type DiscoverResult = { feedUrl: string; title?: string };

const COMMON_FEED_PATHS = [
  "/feed",
  "/rss",
  "/rss.xml",
  "/feed.xml",
  "/atom.xml",
  "/index.xml",
  "/feeds",
  "/posts.rss",
  // blog/newsroom conventions
  "/blog/feed",
  "/blog/rss.xml",
  "/blog/atom.xml",
  "/news/feed",
  "/news/rss.xml",
  "/press/rss.xml",
  // Apple & co.
  "/newsroom/rss-feed.rss",
];

export async function discoverFeedOrThrow(inputUrl: string, overallTimeoutMs = 20_000): Promise<DiscoverResult> {
  const controller = new AbortController();
  const overallTimer = setTimeout(() => controller.abort(), overallTimeoutMs);
  try {
    const start = Date.now();

    // Set initial candidates
    const candidates = new Set<string>();
    candidates.add(inputUrl);

    let base: URL | null = null;
    try { base = new URL(inputUrl); } catch {}
    if (base) {
      for (const p of COMMON_FEED_PATHS) {
        candidates.add(new URL(p, base).toString());
      }
    }

    // Try to fetch HTML and parse <link rel="alternate" ...>
    try {
      const res = await fetch(inputUrl, { signal: controller.signal, headers: { "user-agent": "FluxRSS/1.0" } });
      const ct = res.headers.get("content-type") || "";
      if (res.ok && ct.includes("html")) {
        const html = await res.text();
        const $ = cheerio.load(html);
        $("link[rel='alternate']").each((_, el) => {
          const type = ($(el).attr("type") || "").toLowerCase();
          if (type.includes("rss") || type.includes("atom") || type.includes("xml")) {
            const href = $(el).attr("href");
            if (href) {
              const abs = base ? new URL(href, base).toString() : href;
              candidates.add(abs);
            }
          }
        });
        $("a[href*='rss'], a[href*='atom'], a[href*='feed']").each((_, el) => {
          const href = $(el).attr("href");
          if (href) {
            const abs = base ? new URL(href, base).toString() : href;
            candidates.add(abs);
          }
        });

        // Heuristique: suivre 1 lien interne type news/blog/press et analyser ses alternates
        const subCandidate = $("a[href]")
          .map((_, el) => $(el).attr("href") || "")
          .toArray()
          .map((h) => (base ? new URL(h, base).toString() : h))
          .filter((u) => u.startsWith(base!.origin))
          .find((u) => /news|blog|press|updates|articles/i.test(u));
        if (subCandidate) {
          try {
            const r2 = await fetch(subCandidate, { signal: controller.signal });
            const c2 = r2.headers.get("content-type") || "";
            if (r2.ok && c2.includes("html")) {
              const h2 = await r2.text();
              const $2 = cheerio.load(h2);
              $2("link[rel='alternate']").each((_, el) => {
                const type = ($2(el).attr("type") || "").toLowerCase();
                if (type.includes("rss") || type.includes("atom") || type.includes("xml")) {
                  const href = $2(el).attr("href");
                  if (href) {
                    const abs = new URL(href, subCandidate).toString();
                    candidates.add(abs);
                  }
                }
              });
            }
          } catch {}
        }
      }
    } catch {}

    // Try candidates sequentially until one parses
    for (const url of candidates) {
      // Per-attempt timeout: remaining time, min 3s
      const elapsed = Date.now() - start;
      const remaining = Math.max(3000, overallTimeoutMs - elapsed);
      try {
        const parsed = await withTimeout(parseFeed(url, { fast: true, maxItems: 40, timeoutMs: Math.min(remaining, 5000) }), remaining);
        if (parsed.items.length > 0) {
          return { feedUrl: url, title: parsed.title };
        }
      } catch {
        // try next
      }
    }

    throw new Error("Aucun flux détecté");
  } finally {
    clearTimeout(overallTimer);
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }).catch((e) => { clearTimeout(t); reject(e); });
  });
}


