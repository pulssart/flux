import { NextResponse } from "next/server";

type SuggestedFeed = { title: string; url: string; domain?: string };

const SOURCE = "https://raw.githubusercontent.com/plenaryapp/awesome-rss-feeds/master/README.md";

export async function GET() {
  try {
    const res = await fetch(SOURCE, { headers: { "user-agent": "FluxRSS/1.0" }, cache: "no-store" });
    if (!res.ok) throw new Error("fetch failed");
    const md = await res.text();

    const suggestions = extractFromMarkdown(md);
    return NextResponse.json({ items: suggestions }, { status: 200 });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur";
    return NextResponse.json({ error: message, items: [] satisfies SuggestedFeed[] }, { status: 200 });
  }
}

function extractFromMarkdown(md: string): SuggestedFeed[] {
  const lines = md.split(/\r?\n/);
  const out: SuggestedFeed[] = [];
  const seen = new Set<string>();

  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("|") || line.startsWith("| Name ")) continue;
    // Match table rows: | Title | <url> | Domain |
    const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
    if (cells.length < 2) continue;
    const titleCell = cells[0];
    const urlCell = cells.find((c) => c.includes("http")) || "";
    const title = stripMd(titleCell);
    const urlMatch = urlCell.match(/<?(https?:\/\/[^>\s]+)>?/i);
    const url = urlMatch?.[1];
    if (!url || !isLikelyFeedUrl(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ title, url });
  }

  // Fallback: scan for bare markdown links [Title](https://...rss...)
  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = linkRegex.exec(md))) {
    const title = m[1];
    const url = m[2];
    if (!isLikelyFeedUrl(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ title, url });
  }

  // If we somehow found very few, try a broad URL regex
  if (out.length < 50) {
    const urlRegex = /(https?:\/\/[^\s)\]]+)/g;
    let u: RegExpExecArray | null;
    while ((u = urlRegex.exec(md))) {
      const url = u[1];
      if (!isLikelyFeedUrl(url)) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      out.push({ title: url, url });
      if (out.length > 2000) break;
    }
  }

  out.sort((a, b) => a.title.localeCompare(b.title));
  return out.slice(0, 1500); // cap large lists
}

function stripMd(s: string): string {
  return s.replace(/\*|`|_/g, "").replace(/<[^>]+>/g, "").trim();
}

function isLikelyFeedUrl(url: string): boolean {
  const u = url.toLowerCase();
  if (!u.startsWith("http")) return false;
  if (u.includes(".opml")) return false;
  if (u.includes("githubusercontent") || u.includes("github.com") || u.includes("forms.gle")) return false;
  return /(rss|atom|feed|\.xml)(\b|$)/i.test(url);
}


