import { NextRequest, NextResponse } from "next/server";
import { parseFeed, ParsedItem } from "@/lib/rss";

// Batch aggregator: POST { feeds: string[] }
export async function POST(req: NextRequest) {
  try {
    const { feeds } = await req.json();
    if (!Array.isArray(feeds) || feeds.length === 0) {
      return NextResponse.json({ items: [] }, { status: 200 });
    }

    const results = await Promise.allSettled(feeds.map((url: string) => parseFeed(url, { fast: true, maxItems: 60, timeoutMs: 5000 })));
    const mergedItems: ParsedItem[] = results.flatMap((res) => (res.status === "fulfilled" ? res.value.items : []));
    // Tri par date décroissante
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


