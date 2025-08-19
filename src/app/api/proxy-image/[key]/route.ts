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

    async function fetchWithRedirects(url: string, maxRedirects = 5): Promise<Response | null> {
      let currentUrl = url;
      for (let i = 0; i <= maxRedirects; i++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        const res = await fetch(currentUrl, {
          signal: controller.signal,
          headers: {
            "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
            accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
            referer: "https://source.unsplash.com/",
          },
          cache: "no-store",
          redirect: "manual",
        }).catch(() => null);
        clearTimeout(timer);
        if (!res) return null;
        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get("location");
          if (!loc) return null;
          try {
            const nextUrl = new URL(loc, currentUrl).toString();
            currentUrl = nextUrl;
            continue;
          } catch {
            return null;
          }
        }
        return res;
      }
      return null;
    }

    const res = await fetchWithRedirects(target.toString(), 5);
    if (!res || !res.ok) {
      return NextResponse.json({ error: `Fetch failed${res ? `: ${res.status}` : ""}` }, { status: 502 });
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


