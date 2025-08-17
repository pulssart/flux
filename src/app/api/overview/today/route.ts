import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";
import * as cheerio from "cheerio";
import { youtubeThumbnailFromLink } from "@/lib/rss";
import { parseFeed } from "@/lib/rss";

export async function POST(req: NextRequest) {
  try {
    const dbgStart = Date.now();
    // Charger la liste des feeds depuis localStorage côté client n'est pas possible ici.
    // On s'attend à recevoir la liste côté client dans le futur; pour MVP on lit un header JSON optionnel.
    interface OverviewRequestBody {
      feeds?: string[];
      lang?: string;
      apiKey?: string;
      fast?: boolean;
      images?: boolean;
      debug?: boolean;
      startMs?: number;
      endMs?: number;
    }
    const raw = await req.json().catch(() => ({}));
    const body: Partial<OverviewRequestBody> = (raw && typeof raw === "object" ? raw : {}) as Partial<OverviewRequestBody>;
    const feeds: string[] = Array.isArray(body.feeds) ? body.feeds : [];
    const lang: string = typeof body.lang === "string" ? body.lang : "fr";
    const apiKey: string | undefined = typeof body.apiKey === "string" && body.apiKey.trim() ? body.apiKey.trim() : (process.env.OPENAI_API_KEY || undefined);
    const fast: boolean = body.fast === true;
    const withImages: boolean = body.images === true;
    if (!feeds.length) {
      return NextResponse.json({ html: "<p>No feeds selected.</p>" }, { status: 200 });
    }
    // Fenêtre temporelle: par défaut dernières 24h, mais si client envoie startMs/endMs (journée locale), les utiliser
    const nowMs = Date.now();
    const clientStart = typeof body.startMs === "number" ? Number(body.startMs) : null;
    const clientEnd = typeof body.endMs === "number" ? Number(body.endMs) : null;
    const thresholdMs = clientStart && Number.isFinite(clientStart) ? clientStart : (nowMs - 24 * 60 * 60 * 1000);

    // Parser: on utilise le parseur central (aligne avec FeedGrid) pour une meilleure robustesse
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
    const isYouTubeHost = (u?: string) => {
      if (!u) return false;
      try {
        const host = new URL(u).hostname.replace(/^www\./, "");
        return host.includes("youtube.") || host.includes("ytimg.") || u.includes("/feeds/videos.xml");
      } catch { return false; }
    };
    const feedsOrdered = [...feeds].sort((a, b) => (isYouTubeHost(b) ? 1 : 0) - (isYouTubeHost(a) ? 1 : 0));
    const maxFeeds = Math.min(fast ? 16 : 30, feedsOrdered.length);
    const chunkSize = fast ? 3 : 3;
    const timeBudgetMs = fast ? 3500 : 8000;
    const startedAt = Date.now();

    type FastItem = { title: string; link?: string; pubDate?: string; contentSnippet?: string; image?: string };
    const items: FastItem[] = [];
    const perFeed: Array<{ feed: string; items: FastItem[] }> = [];


    for (let i = 0; i < maxFeeds; i += chunkSize) {
      if (Date.now() - startedAt > timeBudgetMs) break;
      const slice = feedsOrdered.slice(i, i + chunkSize);
      const results = await Promise.allSettled(
        slice.map((u) => parseFeed(u, { fast: true, maxItems: 40, timeoutMs: 4000 }))
      );
      for (let iRes = 0; iRes < results.length; iRes++) {
        const res = results[iRes];
        const feedUrl = slice[iRes];
        if (res.status !== "fulfilled") continue;
        const list = res.value.items || [];
        const feedItems: FastItem[] = [];
        for (let idx = 0; idx < list.length; idx++) {
          const it = list[idx];
          const title = String(it.title || "Sans titre");
          const link = typeof it.link === "string" ? it.link : undefined;
          if (link && isYouTubeShort(link)) continue;
          const pubDate = it.pubDate;
          const contentSnippet = (it.contentSnippet || "").toString().slice(0, 420);
          if (link && (isYouTubeShort(link) || hasShortsMarker(title, contentSnippet))) continue;
          let image = it.image;
          if (!image && link) {
            const yt = youtubeThumbnailFromLink(link);
            if (yt) image = yt;
          }
          const fastItem: FastItem = { title, link, pubDate, contentSnippet, image: image || undefined };
          feedItems.push(fastItem);
          items.push(fastItem);
          if (idx >= 50) break;
          if (Date.now() - startedAt > timeBudgetMs) break;
        }
        // Trier les items du flux par date desc
        feedItems.sort((a, b) => {
          const ta = a.pubDate ? +new Date(a.pubDate) : 0;
          const tb = b.pubDate ? +new Date(b.pubDate) : 0;
          return tb - ta;
        });
        perFeed.push({ feed: feedUrl, items: feedItems });
      }
      if (items.length >= 200) break; // sécurité
      if (Date.now() - startedAt > timeBudgetMs) break;
    }
    // Dédoublonner pour éviter répétitions d'articles identiques entre flux (mirror, multi-tags, etc.)
    const baseItems = (() => {
      const map = new Map<string, FastItem>();
      const keyOf = (it: FastItem) => ((it.link || "").trim() || (it.title || "").trim().toLowerCase());
      for (const cur of items) {
        const k = keyOf(cur);
        if (!k) continue;
        const prev = map.get(k);
        if (!prev) {
          map.set(k, cur);
          continue;
        }
        // Fusionner: préférer l'item avec image, snippet plus long, date la plus précise
        const merged: FastItem = {
          title: prev.title || cur.title,
          link: prev.link || cur.link,
          pubDate: prev.pubDate || cur.pubDate,
          contentSnippet: (() => {
            const a = (prev.contentSnippet || "").trim();
            const b = (cur.contentSnippet || "").trim();
            if (b && (!a || b.length > a.length)) return b.slice(0, 420);
            return a.slice(0, 420);
          })(),
          image: prev.image || cur.image || undefined,
        };
        // Si l'image est absente sur prev mais présente sur cur, prendre celle de cur
        if (!merged.image && cur.image) merged.image = cur.image;
        map.set(k, merged);
      }
      return Array.from(map.values());
    })();

    const todays = baseItems.filter((it) => {
      if (!it.pubDate) return false;
      const t = +new Date(it.pubDate);
      if (!Number.isFinite(t)) return false;
      if (clientStart && clientEnd && Number.isFinite(clientStart) && Number.isFinite(clientEnd)) {
        return t >= clientStart && t <= clientEnd;
      }
      return t >= thresholdMs;
    });
    // Trier par date desc pour fallback et préparer un round-robin par flux
    const MAX_ITEMS = 24;
    const todaysSorted = [...todays].sort((a, b) => {
      const ta = a.pubDate ? +new Date(a.pubDate) : 0;
      const tb = b.pubDate ? +new Date(b.pubDate) : 0;
      return tb - ta;
    });
    // Fallback: si la journée est pauvre, compléter avec les plus récents (jusqu'à 72h) pour garantir un flux rempli
    const allSorted = [...baseItems]
      .filter((it) => it.pubDate && Number.isFinite(+new Date(it.pubDate)))
      .sort((a, b) => {
        const ta = a.pubDate ? +new Date(a.pubDate) : 0;
        const tb = b.pubDate ? +new Date(b.pubDate) : 0;
        return tb - ta;
      });
    const seventyTwoHoursAgo = nowMs - 72 * 60 * 60 * 1000;
    const fallbackRecent = allSorted.filter((it) => {
      const t = it.pubDate ? +new Date(it.pubDate) : 0;
      return t >= seventyTwoHoursAgo;
    });
    // Construire une sélection proportionnelle aux flux: round-robin par flux (1 à 2 items par tour)
    const byFeedTodays = perFeed.map(({ feed, items }) => {
      const arr = items.filter((it) => {
        if (!it.pubDate) return false;
        const t = +new Date(it.pubDate);
        if (!Number.isFinite(t)) return false;
        if (clientStart && clientEnd && Number.isFinite(clientStart) && Number.isFinite(clientEnd)) {
          return t >= clientStart && t <= clientEnd;
        }
        return t >= thresholdMs;
      });
      return { feed, items: arr };
    });
    const byFeedRecent72 = perFeed.map(({ feed, items }) => {
      const arr = items.filter((it) => {
        if (!it.pubDate) return false;
        const t = +new Date(it.pubDate);
        return Number.isFinite(t) && t >= seventyTwoHoursAgo;
      });
      return { feed, items: arr };
    });

    const seenKey = new Set<string>();
    const pushIfNew = (dst: FastItem[], it: FastItem) => {
      const key = (it.link || it.title || "").trim().toLowerCase();
      if (!key || seenKey.has(key)) return false;
      seenKey.add(key);
      dst.push(it);
      return true;
    };

    const roundRobinFill = (groups: Array<{ feed: string; items: FastItem[] }>, maxPerFeedFirstPass = 2) => {
      const indices = new Map<string, number>();
      for (const g of groups) indices.set(g.feed, 0);
      // Première passe: jusqu'à maxPerFeedFirstPass par flux
      for (let pass = 0; pass < maxPerFeedFirstPass; pass++) {
        for (const g of groups) {
          const i = indices.get(g.feed) || 0;
          if (i >= g.items.length) continue;
          if (baseForSelection.length >= MAX_ITEMS) return;
          if (pushIfNew(baseForSelection, g.items[i])) indices.set(g.feed, i + 1);
        }
      }
      // Passes suivantes: un par tour jusqu'à remplir
      let still = true;
      while (still && baseForSelection.length < MAX_ITEMS) {
        still = false;
        for (const g of groups) {
          const i = indices.get(g.feed) || 0;
          if (i >= g.items.length) continue;
          if (baseForSelection.length >= MAX_ITEMS) return;
          if (pushIfNew(baseForSelection, g.items[i])) {
            indices.set(g.feed, i + 1);
            still = true;
          }
        }
      }
    };

    const baseForSelection: typeof items = [];
    // 1) Remplir avec "aujourd'hui" proportionnellement
    roundRobinFill(byFeedTodays, 2);
    // 2) Fallback 72h proportionnellement si besoin
    if (baseForSelection.length < MAX_ITEMS) {
      roundRobinFill(byFeedRecent72, 1);
    }
    // 3) Fallback global (allSorted) pour terminer si besoin
    if (baseForSelection.length < MAX_ITEMS) {
      for (const it of allSorted) {
        if (baseForSelection.length >= MAX_ITEMS) break;
        pushIfNew(baseForSelection, it);
      }
    }
    const isYouTube = (u?: string) => {
      if (!u) return false;
      try {
        const host = new URL(u).hostname.replace(/^www\./, "");
        if (host !== "youtube.com" && host !== "youtu.be" && host !== "m.youtube.com" && !host.endsWith("youtube-nocookie.com")) return false;
        // Écarter Shorts
        if (isYouTubeShort(u)) return false;
        return true;
      } catch { return false; }
    };
    const MAX_YT = 4;
    // Inclure des vidéos même si très peu d'articles
    const yt = baseForSelection.filter((x) => isYouTube(x.link));
    const nonYt = baseForSelection.filter((x) => !isYouTube(x.link));
    // Interleave: 2 articles puis 1 vidéo (si dispo), pour éviter un flux composé uniquement de vidéos
    const mergedPrioritized: typeof items = [];
    let iArticle = 0;
    let iYt = 0;
    let ytUsed = 0;
    while (mergedPrioritized.length < MAX_ITEMS && (iArticle < nonYt.length || iYt < yt.length)) {
      // Ajouter jusqu'à 2 articles si possible, sinon prendre 1 vidéo
      let addedArticles = 0;
      for (let k = 0; k < 2 && mergedPrioritized.length < MAX_ITEMS && iArticle < nonYt.length; k++) {
        mergedPrioritized.push(nonYt[iArticle++]);
        addedArticles++;
      }
      if (addedArticles === 0 && mergedPrioritized.length < MAX_ITEMS && iYt < yt.length && ytUsed < MAX_YT) {
        mergedPrioritized.push(yt[iYt++]);
        ytUsed++;
      }
      // Puis 1 vidéo si on n'a pas dépassé le plafond YouTube
      if (mergedPrioritized.length < MAX_ITEMS && iYt < yt.length && ytUsed < MAX_YT) {
        mergedPrioritized.push(yt[iYt++]);
        ytUsed++;
      }
      // Si plus d'articles du tout et qu'il reste des vidéos, on complète (jusqu'à MAX_YT)
      if (iArticle >= nonYt.length && mergedPrioritized.length < MAX_ITEMS && iYt < yt.length && ytUsed < MAX_YT) {
        mergedPrioritized.push(yt[iYt++]);
        ytUsed++;
      }
    }
    const limited = mergedPrioritized.slice(0, MAX_ITEMS);

    // Compléter les images manquantes via OG (quota limité)
    let toComplete = limited.filter((x) => !x.image && x.link);
    // En mode rapide, n'enrichir que quelques items pour réduire le temps
    if (fast) toComplete = toComplete.slice(0, 12);
    if ((withImages || !fast) && Date.now() - startedAt < timeBudgetMs - 1500 && toComplete.length) {
      // 1ère passe: OG rapide
      await Promise.allSettled(
        toComplete.map(async (it) => {
          try {
            const og = await fetchOg(it.link as string, 1200);
            if (og && og.image) it.image = og.image || undefined;
          } catch {}
        })
      );
      // 2ème passe: endpoint edge (parfois plus permissif/CDN)
      const still = limited.filter((x) => !x.image && x.link);
      if (still.length && Date.now() - startedAt < timeBudgetMs - 800) {
        const origin = (() => {
          try { return new URL(req.url).origin; } catch {}
          try { return (req as any)?.nextUrl?.origin || ""; } catch {}
          return process.env.NEXT_PUBLIC_SITE_URL || "";
        })();
        if (origin) {
        await Promise.allSettled(
          still.map(async (it) => {
            try {
              const r = await fetch(`${origin}/api/og-image?u=${encodeURIComponent(it.link as string)}`);
              if (r.ok) {
                const j = (await r.json()) as { image?: string | null };
                if (j.image) it.image = j.image;
              }
            } catch {}
          })
        );
        }
      }
    }
    // 3ème passe rapide: favicon domaine si toujours vide
    for (const it of limited) {
      if (!it.image && it.link) {
        try {
          const u = new URL(it.link);
          it.image = `https://icons.duckduckgo.com/ip3/${u.hostname}.ico`;
        } catch {}
      }
    }

    // Tentative de fallback: si pas d'image OG, utiliser favicon du domaine (mieux que rien)
    for (const it of limited) {
      if (!it.image && it.link) {
        try {
          const u = new URL(it.link);
          it.image = `https://icons.duckduckgo.com/ip3/${u.hostname}.ico`;
        } catch {}
      }
    }

    // Résumés par article dans la langue cible si clé API disponible
    let perItemSummaries: string[] = [];
    const timeSpentMs = Date.now() - startedAt;
    const timeLeftMs = timeBudgetMs - timeSpentMs;
    if (!fast && apiKey && timeLeftMs > 2000) {
      try {
        perItemSummaries = await summarizeItemsWithAI(
          limited.map((x) => ({ title: x.title, snippet: x.contentSnippet })),
          lang,
          apiKey
        );
      } catch {}
    }

    const viewLabel = lang === "en" ? "View article" : "Voir l’article";

    // Construire un HTML éditorial (titre + cartes élégantes)
    const toBase64Url = (s: string) => {
      const b64 = Buffer.from(s, "utf-8").toString("base64");
      return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    };
    const blocks = limited.map((it, idx) => {
      const proxy = (url: string) => `/api/proxy-image/${toBase64Url(url)}`;
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
    if (!fast && apiKey && (timeBudgetMs - (Date.now() - startedAt) > 1500)) {
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
    const itemsOut = limited.map((it, idx) => {
      const summary = (perItemSummaries[idx] && perItemSummaries[idx].trim()) || it.contentSnippet || "";
      let host = "";
      try { if (it.link) host = new URL(it.link).hostname.replace(/^www\./, ""); } catch {}
      return { title: it.title, link: it.link || null, image: it.image || null, summary, host, pubDate: it.pubDate || null };
    });
    const dbg = { items: itemsOut.length, timeMs: Date.now() - dbgStart, completedImages: itemsOut.filter(i => i.image).length };
    return NextResponse.json({ html, items: itemsOut, intro, dbg }, { status: 200 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Error";
    const stack = e instanceof Error ? e.stack : undefined;
    console.error("/api/overview/today failed:", e);
    return NextResponse.json({ error: msg, stack }, { status: 500 });
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
  const parsed = tryParseArray(text);
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


