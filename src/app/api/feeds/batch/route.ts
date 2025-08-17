import { NextRequest, NextResponse } from "next/server";
import { parseFeed, ParsedItem } from "@/lib/rss";

export async function POST(req: NextRequest) {
  try {
    const { feeds } = await req.json();
    if (!Array.isArray(feeds) || feeds.length === 0) {
      return NextResponse.json({ items: [] }, { status: 200 });
    }

    const results = await Promise.allSettled(feeds.map((url: string) => parseFeed(url, { fast: true, maxItems: 60, timeoutMs: 5000 })));
    let mergedItems: ParsedItem[] = results.flatMap((res) => (res.status === "fulfilled" ? res.value.items : []));
    // Filtrer YouTube Shorts (réels/verticales) par URL et par libellé
    const isYouTubeShort = (u?: string) => {
      if (!u) return false;
      try {
        const url = new URL(u);
        const parts = url.pathname.split("/").filter(Boolean).map((s) => s.toLowerCase());
        return parts.includes("shorts");
      } catch { return false; }
    };
    const hasShortsMarker = (title?: string, snippet?: string) => {
      const s = `${title || ""} ${snippet || ""}`.toLowerCase();
      return /#shorts\b/.test(s) || /\bshorts\b/.test(s);
    };
    mergedItems = mergedItems.filter((it) => !(isYouTubeShort(it.link) || hasShortsMarker(it.title, it.contentSnippet)));
    mergedItems.sort((a, b) => {
      const da = a.pubDate ? +new Date(a.pubDate) : 0;
      const db = b.pubDate ? +new Date(b.pubDate) : 0;
      return db - da;
    });
    return NextResponse.json({ items: mergedItems }, { status: 200 });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}


