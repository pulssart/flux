import { NextResponse } from "next/server";

export const runtime = "edge";

function decodeBase64Url(input: string): string {
  try {
    // Convert base64url to base64 and add padding
    const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
    const pad = base64.length % 4 ? 4 - (base64.length % 4) : 0;
    const b64 = base64 + "=".repeat(pad);
    // Edge runtime exposes atob/btoa
    const binary = atob(b64);
    // Convert binary string to UTF-8
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const decoder = new TextDecoder("utf-8");
    return decoder.decode(bytes);
  } catch {
    return "";
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const key = pathParts[pathParts.length - 1] || "";
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


