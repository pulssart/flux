export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { ApiError } from "@/lib/api-error";
import { generateText, generateSpeech } from "@/lib/openai-client";

type SummarizeTtsBody = {
  // Mode article unique (existant)
  url?: string;
  // Mode digest du jour (nouveau)
  items?: { title: string; snippet?: string }[];
  sourceTitle?: string;
  lang?: string; // "fr" | "en" | ...
  apiKey?: string; // optional client-provided key
  voice?: string; // optional client-provided voice
  textOnly?: boolean; // si true, ne retourne que le texte (pas de TTS)
  mode?: "structured" | "audio"; // structured: pour le lecteur, audio: narration fluide sans sections
};

export async function POST(req: NextRequest) {
  try {
    const { url, items, sourceTitle, lang = "fr", apiKey, voice, textOnly, mode = "structured" } = (await req.json()) as SummarizeTtsBody;
    if (!(apiKey || process.env.OPENAI_API_KEY)) {
      return NextResponse.json({ error: "Clé OpenAI manquante. Renseignez-la dans Réglages." }, { status: 401 });
    }

    // Branche 1: article unique depuis une URL (comportement existant)
    if (url && typeof url === "string") {
      let html: string;
      try {
        html = await fetchWithTimeout(url, 12000);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return NextResponse.json(
          { error: "Échec de récupération de la page", stage: "fetch", details: { url, message } },
          { status: 502 }
        );
      }
      const primary = extractMainText(html);
      let base = (primary || "").trim();
      if (base.length < 120) {
        const $ = cheerio.load(html);
        const fb = $("body").text().trim();
        if (!fb || fb.length < 80) {
          return NextResponse.json(
          { error: "Article introuvable ou trop court", stage: "extract", details: { primaryLength: base.length, bodyLength: (fb ? fb.length : 0) } },
            { status: 422 }
          );
        }
        base = fb;
      }

      const normalized = base.replace(/[\u0000-\u001F\u007F]+/g, " ").replace(/\s+/g, " ").trim();
      const cleaned = sanitizeContent(normalized);
      const limited = cleaned.slice(0, 20000);

      let summary: string;
      try {
        const prompt = mode === "audio"
          ? (lang === "fr"
              ? "Nettoie d'abord le texte source pour retirer publicités, appels à l'action, mentions de cookies, navigation et tout contenu non éditorial.\n\n" +
                "À partir de ce texte propre, écris un RÉSUMÉ NARRATIF en français adapté à une lecture audio: 6 à 10 phrases, fluides, sans titres ni puces, sans sections nommées, sans emoji. " +
                "Va à l'essentiel, intègre les faits clés (noms, chiffres utiles) et assure une progression naturelle avec de courtes transitions. " +
                "Évite les citations longues; si nécessaire, intègre une courte citation au sein d'une phrase. " +
                "Longueur ciblée: 700 à 1200 caractères."
              : "First, clean the source text to remove ads/CTAs/cookies/navigation and any non‑editorial content.\n\n" +
                "From this cleaned text, write a NARRATIVE SUMMARY in English suitable for audio: 6–10 sentences, fluent, no headings, no bullets, no section labels, no emojis. " +
                "Focus on key facts (proper nouns, meaningful numbers) and provide a natural flow with brief transitions. " +
                "Avoid long quotes; if needed, weave a short quote into a sentence. " +
                "Target length: 700–1200 characters.")
          : (lang === "fr"
              ? "Nettoie d'abord le texte source pour retirer toute trace de publicités, appels à l'action (abonnement, newsletter), mentions de cookies, éléments de navigation ou sections non reliées au contenu journalistique. Ne garde que le texte éditorial.\n\n" +
                "À partir de ce texte propre, produis un RÉSUMÉ STRUCTURÉ en français (plus détaillé) au format SUIVANT (strict) :\n\n" +
                "TL;DR: 1 phrase synthétique.\n" +
                "Points clés:\n- 6 à 10 puces courtes, factuelles et lisibles (noms propres, chiffres utiles)\n" +
                "Contexte: 2 à 4 phrases pour situer le sujet (qui, quoi, où, enjeux).\n" +
                "À suivre: 1 à 3 puces sur les suites possibles ou impacts.\n" +
                "Citation: une courte citation pertinente si disponible (sinon omets cette section).\n\n" +
                "Ne fais pas d'introduction ou de conclusion hors de ces sections. Pas d'emoji."
              : "First, clean the source text to remove any ads, calls-to-action (subscribe/newsletter), cookie notices, navigation, or unrelated blocks. Keep only editorial content.\n\n" +
                "From this cleaned text, produce a more DETAILED structured summary in English with the EXACT format below:\n\n" +
                "TL;DR: 1 concise sentence.\n" +
                "Key points:\n- 6 to 10 short, factual bullets (proper nouns, meaningful numbers)\n" +
                "Context: 2–4 sentences to frame the story (who, what, where, stakes).\n" +
                "What to watch: 1–3 bullets on likely follow‑ups or impact.\n" +
                "Quote: a short relevant quote if available (otherwise omit this section).\n\n" +
                "Do not add intro/outro beyond these sections. No emojis.");

        summary = await generateText(prompt, limited, apiKey || "", {
          timeoutMs: 25000,
          retries: 2,
          model: "gpt-5-nano"
        });
      } catch (e: unknown) {
        if (e instanceof ApiError) {
          return NextResponse.json(
            { error: e.message, stage: "summary" },
            { status: e.status }
          );
        }
        const message = e instanceof Error ? e.message : String(e);
        // Fallback minimal: tronquer le contenu nettoyé si le modèle échoue
        const fallback = limited.slice(0, 800);
        return NextResponse.json({ text: fallback, partial: true, reason: "summary-fallback", error: message }, { status: 200 });
      }

      if (textOnly) {
        return NextResponse.json({ text: summary }, { status: 200 });
      }

      try {
        const audioChunks = await generateSpeech(summary, voice || "alloy", apiKey || "", {
          timeoutMs: 30000,
          retries: 2
        });
        
        // Si on a plusieurs chunks audio, on les concatène
        const audio = audioChunks.join(",");
        return NextResponse.json({ text: summary, audio, chunks: audioChunks.length }, { status: 200 });
      } catch (e: unknown) {
        // Fallback: retourner le texte même si la synthèse audio échoue/timeout
        const isTimeout = e instanceof ApiError ? e.status === 504 : false;
        return NextResponse.json({ text: summary, partial: true, reason: isTimeout ? "tts-timeout" : "tts-failed" }, { status: 200 });
      }
    }

    // Branche 2: digest du jour depuis liste de titres/extraits
    if (Array.isArray(items) && items.length > 0) {
      const input = buildDigestInput(items);
      let digestSummary: string;
      try {
        const prompt = lang === "fr"
          ? "À partir d'une liste de titres et d'extraits d'articles du jour, produis un court bulletin structuré (4 à 7 phrases) en français, regroupant les grands thèmes et reliant les infos de manière fluide."
          : "From a list of today's headlines and snippets, produce a short structured bulletin (4-7 sentences) summarizing key themes in the requested language.";

        digestSummary = await generateText(prompt, input, apiKey || "", {
          timeoutMs: 25000,
          retries: 2,
          model: "gpt-5-nano"
        });
      } catch (e: unknown) {
        if (e instanceof ApiError) {
          return NextResponse.json(
            { error: e.message, stage: "summary" },
            { status: e.status }
          );
        }
        const message = e instanceof Error ? e.message : String(e);
        return NextResponse.json(
          { error: message, stage: "summary" },
          { status: 500 }
        );
      }

      const prefix = lang === "fr"
        ? `Voici l'actualité du jours depuis ${sourceTitle || "votre sélection"} : `
        : `Here is today's news from ${sourceTitle || "your selection"}: `;
      const finalText = `${prefix}${digestSummary}`.trim();

      try {
        const audioChunks = await generateSpeech(finalText, voice || "alloy", apiKey || "", {
          timeoutMs: 30000,
          retries: 2
        });
        
        // Si on a plusieurs chunks audio, on les concatène
        const audio = audioChunks.join(",");
        return NextResponse.json({ text: finalText, audio, chunks: audioChunks.length }, { status: 200 });
      } catch (e: unknown) {
        if (e instanceof ApiError) {
          return NextResponse.json(
            { error: e.message, stage: "tts" },
            { status: e.status }
          );
        }
        const message = e instanceof Error ? e.message : String(e);
        return NextResponse.json({ text: finalText, partial: true, reason: "tts-failed", error: message }, { status: 200 });
      }
    }

    return NextResponse.json({ error: "Requête invalide: url ou items requis" }, { status: 400 });
  } catch (e: unknown) {
    if (e instanceof ApiError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    const message = e instanceof Error ? e.message : "Erreur";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "FluxRSS/1.0" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function extractMainText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, nav, header, footer, aside, form, noscript, svg").remove();

  // Essayez d'abord les conteneurs évidents
  const prioritySelectors = [
    "article",
    "main",
    "#content, .content, #main, .main, .post, .article, .entry-content, [itemprop='articleBody']",
  ];

  let best = "";
  for (const sel of prioritySelectors) {
    const el = $(sel).first();
    const txt = el.text().trim();
    if (txt.length > best.length) best = txt;
  }

  // Heuristique de lisibilité: scorer les blocs
  if (best.length < 300) {
    type Candidate = { score: number; text: string };
    let top: Candidate = { score: 0, text: "" };
    $("article, main, section, div").each((_, el) => {
      const node = $(el);
      const text = node.find("p, li").text().trim();
      const len = text.length;
      if (len < 200) return;
      const linkText = node.find("a").text().length;
      const linkDensity = len ? Math.min(0.9, linkText / len) : 0;
      const headings = node.find("h1, h2").text().length;
      const score = len * (1 - linkDensity) + Math.min(200, headings);
      if (score > top.score) top = { score, text };
    });
    if (top.text) best = top.text;
  }

  // Nettoyage final
  best = best.replace(/\s+/g, " ").trim();
  return best;
}

function buildDigestInput(items: { title: string; snippet?: string }[]): string {
  const parts = items.map((it, idx) => {
    const snip = (it.snippet || "").replace(/\s+/g, " ").trim().slice(0, 300);
    return `${idx + 1}. ${it.title}${snip ? ` — ${snip}` : ""}`;
  });
  return parts.join("\n");
}

function sanitizeContent(input: string): string {
  try {
    const lower = (s: string) => s.toLowerCase();
    const adKeywords = [
      "advertisement", "advert", "sponsored", "sponsor", "affiliate",
      "newsletter", "subscribe", "sign up", "cookie", "cookies",
      "read more", "related", "comments", "share this", "promo", "coupon", "deal", "offer",
      // FR
      "publicité", "sponsorisé", "sponsorisée", "abonnez-vous", "inscrivez-vous",
      "cookies", "bandeau", "lire aussi", "à lire aussi", "commentaires", "partager", "offre", "promo", "bon plan"
    ];
    const sentences = input.split(/(?<=[\.!?])\s+/);
    const keep = sentences.filter((s) => {
      const ls = lower(s);
      return !adKeywords.some((kw) => ls.includes(kw));
    });
    const joined = keep.join(" ").replace(/\s+/g, " ").trim();
    return joined || input;
  } catch {
    return input;
  }
}


