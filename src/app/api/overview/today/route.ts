import { NextRequest, NextResponse } from "next/server";
import Parser from "rss-parser";
import * as cheerio from "cheerio";

export async function POST(req: NextRequest) {
  try {
    // Charger la liste des feeds depuis localStorage côté client n'est pas possible ici.
    // On s'attend à recevoir la liste côté client dans le futur; pour MVP on lit un header JSON optionnel.
    const body = await req.json().catch(() => ({}));
    const feeds: string[] = Array.isArray(body?.feeds) ? body.feeds : [];
    const lang: string = typeof body?.lang === "string" ? body.lang : "fr";
    const apiKey: string | undefined = typeof body?.apiKey === "string" && body.apiKey.trim() ? body.apiKey.trim() : (process.env.OPENAI_API_KEY || undefined);
    if (!feeds.length) {
      return NextResponse.json({ html: "<p>No feeds selected.</p>" }, { status: 200 });
    }
    // Fenêtre temporelle: dernières 24h (plus robuste que minuit local serveur)
    const nowMs = Date.now();
    const thresholdMs = nowMs - 24 * 60 * 60 * 1000;

    // Parser rapide sans enrichissement OG (plus performant)
    const parser = new Parser({ timeout: 7000 });
    const maxFeeds = Math.min(30, feeds.length);
    const chunkSize = 5;
    const timeBudgetMs = 12000;
    const startedAt = Date.now();

    type FastItem = { title: string; link?: string; pubDate?: string; contentSnippet?: string; image?: string };
    const items: FastItem[] = [];

    function stripHtml(html?: string): string {
      if (!html) return "";
      return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    }
    function extractImageFromEnclosure(anyItem: any): string | undefined {
      const enc = anyItem?.enclosure;
      if (enc?.url && (!enc.type || String(enc.type).startsWith("image/"))) return String(enc.url);
      const media = anyItem["media:content"] || anyItem["media:thumbnail"] || anyItem["itunes:image"];
      if (typeof media === "string") return media;
      if (media && typeof media === "object") {
        const u = media.url || media.href || (media["$"] && media["$"]?.url);
        if (typeof u === "string") return u;
      }
      return undefined;
    }

    for (let i = 0; i < maxFeeds; i += chunkSize) {
      if (Date.now() - startedAt > timeBudgetMs) break;
      const slice = feeds.slice(i, i + chunkSize);
      const results = await Promise.allSettled(slice.map((u) => parser.parseURL(u)));
      for (const res of results) {
        if (res.status !== "fulfilled") continue;
        for (let idx = 0; idx < (res.value.items || []).length; idx++) {
          const it: any = res.value.items[idx];
          const title = String(it.title || "Sans titre");
          const link = typeof it.link === "string" ? it.link : undefined;
          const pubDate = (it.isoDate as string) || (it.pubDate as string) || undefined;
          const contentSnippet = String(it.contentSnippet || stripHtml((it["content:encoded"] as string) || (it.content as string) || "")).slice(0, 420);
          const image = extractImageFromEnclosure(it);
          items.push({ title, link, pubDate, contentSnippet, image });
        }
      }
      if (items.length >= 120) break; // sécurité
    }
    const todays = items.filter((it) => {
      if (!it.pubDate) return false;
      const t = +new Date(it.pubDate);
      return Number.isFinite(t) && t >= thresholdMs;
    });
    // Trier par date desc et limiter à 12
    const MAX_ITEMS = 12;
    const todaysSorted = [...todays].sort((a, b) => {
      const ta = a.pubDate ? +new Date(a.pubDate) : 0;
      const tb = b.pubDate ? +new Date(b.pubDate) : 0;
      return tb - ta;
    });
    const limited = todaysSorted.slice(0, MAX_ITEMS);

    // Compléter les images manquantes via OG (quota limité)
    const toComplete = limited.filter((x) => !x.image && x.link).slice(0, MAX_ITEMS);
    await Promise.allSettled(
      toComplete.map(async (it) => {
        try {
          const og = await fetchOg(it.link as string, 1800);
          if (og?.image) (it as any).image = og.image;
        } catch {}
      })
    );

    // Résumés par article dans la langue cible si clé API disponible
    let perItemSummaries: string[] = [];
    if (apiKey) {
      try {
        perItemSummaries = await summarizeItemsWithAI(
          limited.map((x) => ({ title: x.title, snippet: x.contentSnippet })),
          lang,
          apiKey
        );
      } catch {}
    }

    // H1 date localisée
    const date = new Date();
    const formatter = new Intl.DateTimeFormat(lang === "en" ? "en-US" : "fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    const dateTitle = formatter.format(date);
    const viewLabel = lang === "en" ? "View article" : "Voir l’article";

    // Construire un HTML éditorial (titre + cartes élégantes)
    const blocks = limited.map((it, idx) => {
      const proxy = (url: string) => `/api/proxy-image?u=${encodeURIComponent(url)}`;
      const img = it.image
        ? `<div style="margin:0 0 12px 0;"><img src="${proxy(it.image)}" alt="" style="display:block;max-width:100%;height:auto;border-radius:12px;"/></div>`
        : "";
      const link = it.link
        ? `<a href="${escapeHtml(it.link)}" target="_blank" rel="noreferrer">${escapeHtml(it.title)}</a>`
        : escapeHtml(it.title);
      const cho = perItemSummaries[idx] && perItemSummaries[idx].trim() ? perItemSummaries[idx] : (it.contentSnippet || "");
      const snip = cho ? `<p style="margin:6px 0 0 0;">${escapeHtml(cho)}</p>` : "";
      let fav = "";
      if (it.link) {
        try {
          const u = new URL(it.link);
          const host = u.hostname;
          const favUrl = `https://icons.duckduckgo.com/ip3/${escapeHtml(host)}.ico`;
          fav = `<img src="${proxy(favUrl)}" alt="" style="width:14px;height:14px;border-radius:3px;object-fit:cover;"/>`;
        } catch {}
      }
      const cta = it.link
        ? `<a href="${escapeHtml(it.link)}" target="_blank" rel="noreferrer" style="display:inline-flex;align-items:center;gap:8px;margin-top:10px;padding:6px 12px;border:1px solid rgba(0,0,0,.18);border-radius:999px;text-decoration:none;">${fav}${viewLabel} →</a>`
        : "";
      return `<section style="margin:20px 0;padding:16px;border:1px solid rgba(0,0,0,.12);border-radius:14px;background:rgba(127,127,127,.03);"><h3 style="margin:0 0 6px 0;font-weight:700;font-size:1.15rem;line-height:1.35;">${link}</h3>${img}${snip}${cta}</section>`;
    });
    // Option: générer un chapeau éditorial dans la langue, si clé API dispo
    let intro = "";
    if (apiKey) {
      try {
        const prompt = lang === "fr"
          ? "Rédige un court chapeau (2 à 4 phrases) en français résumant les grands thèmes des actualités listées ci-dessous."
          : "Write a short lead (2-4 sentences) summarizing the key themes from the following news items in English.";
        const joined = limited.map((it) => `- ${it.title}${it.contentSnippet ? ": " + it.contentSnippet : ""}`).join("\n");
        const resp = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model: "gpt-5-nano", input: `${prompt}\n\n${joined}` }),
        });
        if (resp.ok) {
          const j = await resp.json();
          const text = (j?.output_text || "").toString().trim();
          if (text) intro = `<p style=\"font-weight:600;margin:0 0 16px 0;font-size:1.05rem;\">${escapeHtml(text)}</p>`;
        }
      } catch {}
    }

    const html = `${intro}${blocks.join("\n")}`;
    return NextResponse.json({ html }, { status: 200 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function fetchOg(url: string, timeoutMs = 2000): Promise<{ image?: string | null } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "FluxRSS/1.0" } });
    const ct = res.headers.get("content-type") || "";
    if (!res.ok || !ct.includes("html")) return null;
    const html = await res.text();
    const $ = cheerio.load(html);
    const ogImage =
      $("meta[property='og:image']").attr("content") ||
      $("meta[name='og:image']").attr("content") ||
      $("meta[property='og:image:secure_url']").attr("content") ||
      $("meta[name='twitter:image']").attr("content") ||
      $("link[rel='image_src']").attr("href");
    return { image: ogImage || null };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function summarizeItemsWithAI(
  items: { title: string; snippet?: string }[],
  lang: string,
  apiKey: string
): Promise<string[]> {
  const languageName = lang === "fr" ? "français" : "English";
  const headJSON =
    lang === "fr"
      ? "Tu es un assistant rédactionnel. Pour chaque élément, écris 1 à 2 phrases en français, concises et factuelles. Réponds STRICTEMENT un tableau JSON de chaînes (pas d'autre texte)."
      : "You are a writing assistant. For each item, write 1-2 concise, factual sentences in English. Respond STRICTLY with a JSON array of strings (no extra text).";
  const list = items
    .map((it, i) => `${i + 1}. ${it.title}${it.snippet ? ` — ${it.snippet}` : ""}`)
    .join("\n");

  // 1) Tentative JSON stricte
  let text = await callResponses(apiKey, `${headJSON}\n\n${list}`);
  let parsed = tryParseArray(text);
  if (parsed.length) return parsed.slice(0, items.length);

  // 2) Fallback: réponses par lignes en langue cible
  const headLines =
    lang === "fr"
      ? `Écris pour chaque élément une courte phrase en ${languageName}. Retourne une liste de lignes, une par item, dans le même ordre.`
      : `Write for each item a short sentence in ${languageName}. Return newline-separated lines in the same order.`;
  text = await callResponses(apiKey, `${headLines}\n\n${list}`);
  const lines = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, items.length);
  if (lines.length) return lines;

  // 3) Dernier recours: boucle élément par élément (coûteux), limitée aux 12 premiers
  const cap = Math.min(12, items.length);
  const singles: string[] = [];
  for (let i = 0; i < cap; i++) {
    const it = items[i];
    const p =
      lang === "fr"
        ? `Résume en ${languageName} en 1 à 2 phrases, concises et factuelles:\n${it.title}${it.snippet ? ` — ${it.snippet}` : ""}`
        : `Summarize in ${languageName} in 1-2 concise factual sentences:\n${it.title}${it.snippet ? ` — ${it.snippet}` : ""}`;
    const out = await callResponses(apiKey, p);
    singles.push(out.trim());
  }
  return singles;
}

function tryParseArray(text: string): string[] {
  try {
    const arr = JSON.parse(text);
    if (Array.isArray(arr)) return arr.map((s) => (typeof s === "string" ? s : ""));
  } catch {}
  return [];
}

async function callResponses(apiKey: string, input: string): Promise<string> {
  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "gpt-5-nano", input }),
  });
  if (!resp.ok) return "";
  const j = await resp.json().catch(() => null);
  return (j?.output_text || "").toString();
}


