import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";

export const runtime = "nodejs";

async function fetchOg(url: string, timeoutMs = 3000): Promise<{ image?: string | null } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "FluxRSS/1.0" } });
    const ct = res.headers.get("content-type") || "";
    if (!res.ok || !ct.includes("html")) return null;
    const html = await res.text();
    const $ = cheerio.load(html);
    const pickBestFromSrcset = (srcset?: string | null): string | null => {
      if (!srcset) return null;
      const parts = srcset.split(",").map((s) => s.trim()).filter(Boolean);
      let best: { url: string; width: number } | null = null;
      for (const p of parts) {
        const segs = p.split(/\s+/);
        const u = segs[0];
        const wSeg = segs.find((s) => /\d+w$/.test(s));
        const w = wSeg ? parseInt(wSeg.replace(/\D+/g, ""), 10) : 0;
        if (!best || w > best.width) best = { url: u, width: w };
      }
      return best?.url || null;
    };
    const resolveUrl = (raw: string | null | undefined): string | null => {
      if (!raw) return null;
      try { return new URL(raw, url).toString(); } catch { return raw; }
    };
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
      return resolveUrl(src);
    };
    // 1) Tenter de scrapper une image "héros" (notamment pour openai.com)
    let hero: string | null = null;
    try {
      const heroSel = [
        ".wp-block-post-featured-image img",
        ".wp-post-image",
        ".post-thumbnail img",
        ".featured-image img",
        "figure.wp-block-image img",
        "article img:first-of-type",
        "main img:first-of-type",
        "img[data-nimg]",
        "img.object-cover",
        "header img",
        "div[style*=aspect-ratio] img"
      ].join(", ");
      const h = $(heroSel).first();
      if (h && h.length) hero = pickFrom(h);
      if (!hero) {
        const best = pickBestFromSrcset($("source[media][srcset], source[media][data-srcset]").first().attr("srcset") || null);
        if (best) hero = resolveUrl(best);
      }
    } catch {}
    if (hero) return { image: hero };
    // 2) Fallback: OG/Twitter
    const ogRaw =
      $('meta[property="og:image"]').attr('content') ||
      $('meta[name="og:image"]').attr('content') ||
      $('meta[property="og:image:secure_url"]').attr('content') ||
      $('meta[name="twitter:image"]').attr('content') ||
      $('link[rel="image_src"]').attr('href') ||
      null;
    if (!ogRaw) return { image: null };
    return { image: resolveUrl(ogRaw) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(req: NextRequest) {
  try {
    const u = req.nextUrl.searchParams.get("u") || "";
    if (!u) return NextResponse.json({ image: null }, { status: 200 });
    const out = await fetchOg(u, 3000);
    return NextResponse.json(
      { image: out?.image || null },
      { status: 200, headers: { "Cache-Control": "public, max-age=3600, s-maxage=3600" } }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


