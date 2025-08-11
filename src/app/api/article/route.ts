import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";

const BodySchema = {
  parse(input: unknown): { url: string } {
    if (!input || typeof input !== "object") throw new Error("invalid");
    if (!("url" in input)) throw new Error("invalid");
    const maybeUrl = (input as { url: unknown }).url;
    if (typeof maybeUrl !== "string" || !/^https?:\/\//.test(maybeUrl)) throw new Error("invalid");
    return { url: maybeUrl };
  },
};

function absoluteUrl(url: string, base?: string): string {
  try {
    if (!base) return url;
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const { url } = BodySchema.parse(json);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "FluxRSS/1.0" },
      redirect: "follow",
    });
    clearTimeout(timer);
    const ct = res.headers.get("content-type") || "";
    if (!res.ok || !ct.includes("html")) {
      return NextResponse.json({ error: "unreadable" }, { status: 400 });
    }
    const html = await res.text();
    const $ = cheerio.load(html);

    // Remove noisy elements
    $("script, style, nav, footer, header, aside, noscript, form, iframe").remove();

    // Prefer common article containers
    const candidates = [
      "article",
      "main",
      "[role=main]",
      "#content",
      ".content",
      ".post",
      ".entry-content",
      ".article-content",
    ];
    let $container: ReturnType<typeof $> | null = null;
    for (const sel of candidates) {
      const found = $(sel).first();
      if (found && found.length) {
        $container = found;
        break;
      }
    }
    if (!$container) {
      // fallback: the largest block of text
      // Note: type from cheerio isn't exported in ESM build; index any safely
      let best: unknown | null = null;
      let bestLen = 0;
      $("p").each((_, el) => {
        const len = $(el).text().trim().length;
        if (len > bestLen) {
          bestLen = len;
          best = el;
        }
      });
      $container = best ? ($(best as never).parent() as ReturnType<typeof $>) : $("body");
    }

    // Resolve relative links for images and anchors
    $container!.find("img").each((_, el) => {
      const src = $(el).attr("src");
      if (src) $(el).attr("src", absoluteUrl(src, url));
    });
    $container!.find("a").each((_, el) => {
      const href = $(el).attr("href");
      if (href) $(el).attr("href", absoluteUrl(href, url));
    });

    // Keep only safe tags/attrs
    const allowedTags = new Set(["p", "h1", "h2", "h3", "ul", "ol", "li", "strong", "em", "a", "blockquote", "img", "figure", "figcaption", "code", "pre", "hr"]);
    const allowedAttrs = new Set(["href", "src", "alt", "title", "target", "rel"]);
    $container!.find("*").each((_, el) => {
      const $el = $(el as unknown as never);
      const domEl = $el.get(0) as unknown as { tagName?: string; attribs?: Record<string, string> };
      const tag = domEl?.tagName?.toLowerCase?.() || "";
      if (!allowedTags.has(tag)) {
        $el.replaceWith($el.text());
        return;
      }
      const attribs = (domEl?.attribs || {}) as Record<string, string>;
      for (const name of Object.keys(attribs)) {
        if (!allowedAttrs.has(name)) $el.removeAttr(name);
      }
    });

    const title = $("meta[property='og:title']").attr("content") || $("title").text().trim();
    const date = $("meta[property='article:published_time']").attr("content") || $("time").attr("datetime") || "";
    const contentHtml = $container!.html() || "";

    return NextResponse.json({
      title: title || null,
      date: date || null,
      contentHtml,
    });
  } catch {
    return NextResponse.json({ error: "fail" }, { status: 400 });
  }
}


