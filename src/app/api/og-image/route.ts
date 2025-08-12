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
    const raw =
      $('meta[property="og:image"]').attr('content') ||
      $('meta[name="og:image"]').attr('content') ||
      $('meta[property="og:image:secure_url"]').attr('content') ||
      $('meta[name="twitter:image"]').attr('content') ||
      $('link[rel="image_src"]').attr('href') ||
      null;
    if (!raw) return { image: null };
    let abs = raw;
    try {
      const u = new URL(raw, url);
      abs = u.toString();
    } catch {}
    return { image: abs };
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


