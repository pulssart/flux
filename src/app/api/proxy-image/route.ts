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

    async function fetchWithRedirects(url: string, maxRedirects = 5): Promise<Response | null> {
      let currentUrl = url;
      for (let i = 0; i <= maxRedirects; i++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        const res = await fetch(currentUrl, {
          signal: controller.signal,
          headers: {
            // User-Agent plus "navigateur" pour certains CDNs
            "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
            accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
            referer: "https://source.unsplash.com/",
          },
          cache: "no-store",
          redirect: "manual",
        }).catch(() => null);
        clearTimeout(timer);
        if (!res) return null;
        // Suivre manuellement 3xx
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

    const contentType = res.headers.get("content-type") || "image/jpeg";
    const arrayBuffer = await res.arrayBuffer();
    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        // Cache navigateur/CDN (1 jour) + SWR, immuable sur cette URL précise
        "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800, immutable",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


