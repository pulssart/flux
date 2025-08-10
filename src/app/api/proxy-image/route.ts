import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  try {
    const u = req.nextUrl.searchParams.get("u") || "";
    if (!u) return NextResponse.json({ error: "Missing url" }, { status: 400 });
    let target: URL;
    try {
      target = new URL(u);
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
      // Allow CDN/proxy caching
      cache: "force-cache",
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
        // Cache côté navigateur et edge (1 jour) + stale-while-revalidate
        "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


