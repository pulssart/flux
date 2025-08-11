import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type UnsplashPhoto = {
  id: string;
  urls?: { thumb?: string; small?: string; regular?: string; full?: string };
  width?: number;
  height?: number;
  alt_description?: string | null;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { q?: string; key?: string; perPage?: number; page?: number };
    const q = (body.q || "").toString().trim();
    const key = ((body.key || process.env.UNSPLASH_ACCESS_KEY || process.env.NEXT_PUBLIC_UNSPLASH_KEY || "") as string).toString().trim();
    const perPage = Math.max(1, Math.min(18, Number(body.perPage) || 12));
    const page = Math.max(1, Math.min(50, Number(body.page) || 1));

    if (!q) return NextResponse.json({ error: "Missing query" }, { status: 400 });
    if (!key) return NextResponse.json({ error: "Missing key" }, { status: 400 });

    const url = new URL("https://api.unsplash.com/search/photos");
    url.searchParams.set("query", q);
    url.searchParams.set("orientation", "landscape");
    url.searchParams.set("content_filter", "high");
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("page", String(page));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Accept-Version": "v1",
        Authorization: `Client-ID ${key}`,
      },
      signal: controller.signal,
      cache: "no-store",
      redirect: "follow",
    }).catch(() => null);
    clearTimeout(timer);
    if (!res || !res.ok) {
      const status = res?.status || 502;
      let info: unknown = null;
      try { info = await res?.json(); } catch {}
      return NextResponse.json({ error: "Unsplash request failed", status, info }, { status });
    }

    const data = (await res.json()) as { results?: UnsplashPhoto[]; total?: number; total_pages?: number };
    const out = (data.results || []).map((p) => ({
      id: p.id,
      thumb: p.urls?.thumb || null,
      small: p.urls?.small || null,
      regular: p.urls?.regular || null,
      full: p.urls?.full || null,
      alt: p.alt_description || null,
      width: p.width || null,
      height: p.height || null,
    }));

    return NextResponse.json({ results: out, total: data.total || 0, totalPages: data.total_pages || 0, page, perPage }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


