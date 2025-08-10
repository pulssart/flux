import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

function decodeBase64Url(input: string): string {
  try {
    // Convert base64url to base64
    const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
    // Atob is not available on edge runtime reliably; use Buffer
    const buf = Buffer.from(base64, "base64");
    return buf.toString("utf-8");
  } catch {
    return "";
  }
}

export async function GET(req: NextRequest, { params }: { params: { key: string } }) {
  try {
    const key = params.key || "";
    if (!key) return NextResponse.json({ error: "Missing key" }, { status: 400 });
    const decoded = decodeBase64Url(key);
    if (!decoded) return NextResponse.json({ error: "Invalid key" }, { status: 400 });
    let target: URL;
    try {
      target = new URL(decoded);
    } catch {
      return NextResponse.json({ error: "Invalid url" }, { status: 400 });
    }
    if (!(target.protocol === "http:" || target.protocol === "https:")) {
      return NextResponse.json({ error: "Unsupported protocol" }, { status: 400 });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(target.toString(), {
      signal: controller.signal,
      headers: { "user-agent": "FluxRSS/1.0" },
      // Do not rely on internal fetch cache; rely on CDN browser cache
      cache: "no-store",
    }).catch(() => null);
    clearTimeout(timer);
    if (!res || !res.ok) {
      return NextResponse.json({ error: "Fetch failed" }, { status: 502 });
    }

    const contentType = res.headers.get("content-type") || "application/octet-stream";
    const arrayBuffer = await res.arrayBuffer();
    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        // Strong cache with SWR, keyed by path (includes base64url of original URL)
        "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800, immutable",
        // Help CDNs distinguish variants
        Vary: "Accept, Accept-Encoding",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


