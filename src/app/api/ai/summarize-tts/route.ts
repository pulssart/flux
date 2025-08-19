export const runtime = "nodejs";

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";

// --- Logging util ---
function getTraceId(req: NextRequest): string {
  const incoming = req.headers.get("x-trace-id");
  if (incoming) return incoming;
  try {
    const anyCrypto = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
    if (anyCrypto && typeof anyCrypto.randomUUID === "function") return anyCrypto.randomUUID();
  } catch {}
  return `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function logEvent(traceId: string, stage: string, data?: Record<string, unknown>) {
  try {
    const payload = { traceId, stage, ts: new Date().toISOString(), ...(data || {}) };
    console.info("[summarize-tts]", JSON.stringify(payload));
  } catch {
    console.info("[summarize-tts]", stage);
  }
}

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
  return NextResponse.json({ error: "AI disabled" }, { status: 410 });
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

/*
async function summarizeStructured(input: string, lang: string, clientKey?: string, timeoutMs = 7000): Promise<string> {
  const apiKey = clientKey || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Clé OpenAI manquante");

  const prompt =
    lang === "fr"
      ? (
        "Nettoie d'abord le texte source pour retirer toute trace de publicités, appels à l'action (abonnement, newsletter), mentions de cookies, éléments de navigation ou sections non reliées au contenu journalistique. Ne garde que le texte éditorial.\n\n" +
        "À partir de ce texte propre, produis un RÉSUMÉ STRUCTURÉ en français (plus détaillé) au format SUIVANT (strict) :\n\n" +
        "TL;DR: 1 phrase synthétique.\n" +
        "Points clés:\n- 6 à 10 puces courtes, factuelles et lisibles (noms propres, chiffres utiles)\n" +
        "Contexte: 2 à 4 phrases pour situer le sujet (qui, quoi, où, enjeux).\n" +
        "À suivre: 1 à 3 puces sur les suites possibles ou impacts.\n" +
        "Citation: une courte citation pertinente si disponible (sinon omets cette section).\n\n" +
        "Ne fais pas d'introduction ou de conclusion hors de ces sections. Pas d'emoji."
      )
      : (
        "First, clean the source text to remove any ads, calls-to-action (subscribe/newsletter), cookie notices, navigation, or unrelated blocks. Keep only editorial content.\n\n" +
        "From this cleaned text, produce a more DETAILED structured summary in English with the EXACT format below:\n\n" +
        "TL;DR: 1 concise sentence.\n" +
        "Key points:\n- 6 to 10 short, factual bullets (proper nouns, meaningful numbers)\n" +
        "Context: 2–4 sentences to frame the story (who, what, where, stakes).\n" +
        "What to watch: 1–3 bullets on likely follow‑ups or impact.\n" +
        "Quote: a short relevant quote if available (otherwise omit this section).\n\n" +
        "Do not add intro/outro beyond these sections. No emojis."
      );

  // Utiliser l'API Responses pour gpt-5-nano
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-5-nano",
      input: `${prompt}\n\n${input}`,
    }),
    signal: controller.signal,
  });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let errText = "";
    try {
      const j = await res.json();
      errText = j?.error?.message || JSON.stringify(j);
    } catch {}
    throw new ApiError(res.status, `OpenAI gpt-5-nano: ${errText || res.statusText}`);
  }
  const json: unknown = await res.json();
  const text = extractTextFromResponses(json);
  if (!text) {
    const details = {
      keys: Object.keys(json || {}),
      preview: JSON.stringify(json)?.slice(0, 300),
    };
    throw new ApiError(502, `Réponse vide du modèle: ${JSON.stringify(details)}`);
  }
  return text.trim();
}

async function summarizeForAudio(input: string, lang: string, clientKey?: string, timeoutMs = 7000): Promise<string> {
  const apiKey = clientKey || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Clé OpenAI manquante");

  const prompt =
    lang === "fr"
      ? (
        "Nettoie d'abord le texte source pour retirer publicités, appels à l'action, mentions de cookies, navigation et tout contenu non éditorial.\n\n" +
        "À partir de ce texte propre, écris un RÉSUMÉ NARRATIF en français adapté à une lecture audio: 6 à 10 phrases, fluides, sans titres ni puces, sans sections nommées, sans emoji. " +
        "Va à l'essentiel, intègre les faits clés (noms, chiffres utiles) et assure une progression naturelle avec de courtes transitions. " +
        "Évite les citations longues; si nécessaire, intègre une courte citation au sein d'une phrase. " +
        "Longueur ciblée: 700 à 1200 caractères."
      )
      : (
        "First, clean the source text to remove ads/CTAs/cookies/navigation and any non‑editorial content.\n\n" +
        "From this cleaned text, write a NARRATIVE SUMMARY in English suitable for audio: 6–10 sentences, fluent, no headings, no bullets, no section labels, no emojis. " +
        "Focus on key facts (proper nouns, meaningful numbers) and provide a natural flow with brief transitions. " +
        "Avoid long quotes; if needed, weave a short quote into a sentence. " +
        "Target length: 700–1200 characters."
      );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-5-nano",
      input: `${prompt}\n\n${input}`,
    }),
    signal: controller.signal,
  });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let errText = "";
    try {
      const j = await res.json();
      errText = j?.error?.message || JSON.stringify(j);
    } catch {}
    throw new ApiError(res.status, `OpenAI gpt-5-nano: ${errText || res.statusText}`);
  }
  const json: unknown = await res.json();
  const text = extractTextFromResponses(json);
  if (!text) {
    const details = {
      keys: Object.keys(json || {}),
      preview: JSON.stringify(json)?.slice(0, 300),
    };
    throw new ApiError(502, `Réponse vide du modèle: ${JSON.stringify(details)}`);
  }
  return text.trim();
}

// Retry wrapper: 3 tentatives, backoff 0.5s/1s/2s, avec réduction de la taille d'entrée
async function summarizeWithRetries(
  input: string,
  lang: string,
  apiKey: string | undefined,
  mode: "structured" | "audio",
  budgetMs?: number,
  traceId?: string
): Promise<string> {
  const attempts = [1, 2, 3];
  let lastErr: unknown = null;
  let text = input;
  for (const n of attempts) {
    try {
      const perTry = typeof budgetMs === "number" ? Math.max(2500, Math.floor(budgetMs / (attempts.length + 1 - n))) : 9000;
      logEvent(traceId || "", "summary.attempt", { attempt: n, textLength: text.length, mode, lang, budgetMs: perTry });
      const result = mode === "audio"
        ? await summarizeForAudio(text, lang, apiKey, perTry)
        : await summarizeStructured(text, lang, apiKey, perTry);
      if (result && result.trim()) return result.trim();
      throw new ApiError(502, "empty-summary");
    } catch (e: unknown) {
      lastErr = e;
      // Si timeout, on réduit l'entrée et on retente
      const isTimeout = e instanceof ApiError ? e.status === 504 : false;
      // Réduction progressive: 10k -> 6k -> 3k
      if (isTimeout || n < attempts.length) {
        const limits = [10000, 6000, 3000];
        text = input.slice(0, limits[n] || 3000);
        logEvent(traceId || "", "summary.attempt.error", {
          attempt: n,
          isTimeout,
          message: e instanceof Error ? e.message : String(e),
          nextLength: text.length,
        });
        await new Promise((r) => setTimeout(r, 500 * n));
        continue;
      }
      throw e;
    }
  }
  // Si tout échoue, re-lancer la dernière erreur (souvent ApiError 504)
  if (lastErr instanceof ApiError) throw lastErr;
  throw new ApiError(502, (lastErr as Error)?.message || "summary-failed");
}

function buildDigestInput(items: { title: string; snippet?: string }[]): string {
  const parts = items.map((it, idx) => {
    const snip = (it.snippet || "").replace(/\s+/g, " ").trim().slice(0, 300);
    return `${idx + 1}. ${it.title}${snip ? ` — ${snip}` : ""}`;
  });
  return parts.join("\n");
}

async function summarizeDailyDigestWithGPT5(input: string, lang: string, clientKey?: string): Promise<string> {
  const apiKey = clientKey || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Clé OpenAI manquante");

  const prompt =
    lang === "fr"
      ? "À partir d'une liste de titres et d'extraits d'articles du jour, produis un court bulletin structuré (4 à 7 phrases) en français, regroupant les grands thèmes et reliant les infos de manière fluide."
      : "From a list of today's headlines and snippets, produce a short structured bulletin (4-7 sentences) summarizing key themes in the requested language.";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-5-nano",
      input: `${prompt}\n\n${input}`,
    }),
    signal: controller.signal,
  });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let errText = "";
    try {
      const j = await res.json();
      errText = j?.error?.message || JSON.stringify(j);
    } catch {}
    throw new ApiError(res.status, `OpenAI gpt-5-nano: ${errText || res.statusText}`);
  }
  const json: unknown = await res.json();
  const text = extractTextFromResponses(json);
  if (!text) {
    const details = {
      keys: Object.keys(json || {}),
      preview: JSON.stringify(json)?.slice(0, 300),
    };
    throw new ApiError(502, `Réponse vide du modèle: ${JSON.stringify(details)}`);
  }
  return text.trim();
}
*/

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

function extractTextFromResponses(json: unknown): string {
  if (!json || typeof json !== "object") return "";
  // output_text
  const outputText = (json as { output_text?: unknown }).output_text;
  if (typeof outputText === "string" && outputText.trim()) return outputText;
  // responses.output[].content[].text
  const outputArr = Array.isArray((json as { output?: unknown }).output)
    ? ((json as { output?: unknown }).output as unknown[])
    : [];
  for (const o of outputArr) {
    const content = Array.isArray((o as { content?: unknown }).content)
      ? ((o as { content?: unknown }).content as unknown[])
      : [];
    for (const c of content) {
      const cText = (c as { text?: unknown }).text;
      if (typeof cText === "string" && cText.trim()) return cText;
      const nested = Array.isArray((c as { content?: unknown }).content)
        ? ((c as { content?: unknown }).content as unknown[])
        : [];
      for (const cc of nested) {
        const nText = (cc as { text?: unknown }).text;
        if (typeof nText === "string" && nText.trim()) return nText;
      }
    }
  }
  // sometimes under json.content[] directly
  const contentArr = Array.isArray((json as { content?: unknown }).content)
    ? ((json as { content?: unknown }).content as unknown[])
    : [];
  for (const c of contentArr) {
    const cText = (c as { text?: unknown }).text;
    if (typeof cText === "string" && cText.trim()) return cText;
  }
  // chat completions fallback shapes
  const choices = (json as { choices?: unknown }).choices;
  const choice = Array.isArray(choices) ? (choices[0] as unknown) : undefined;
  const messageContent = (choice as { message?: { content?: unknown } })?.message?.content;
  if (typeof messageContent === "string" && messageContent.trim()) return messageContent;
  const choiceText = (choice as { text?: unknown })?.text;
  if (typeof choiceText === "string" && choiceText.trim()) return choiceText;
  return "";
}

async function ttsWithTTS1HD(input: string, lang: string, clientKey?: string, clientVoice?: string, timeoutMs = 26000): Promise<string> {
  const apiKey = clientKey || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Clé OpenAI manquante");

  const allowedVoices = new Set([
    "alloy",
    "echo",
    "fable",
    "onyx",
    "nova",
    "shimmer",
    "coral",
    "verse",
    "ballad",
    "ash",
    "sage",
  ]);
  const resolveVoice = (v?: string): string => {
    if (v && allowedVoices.has(v)) return v;
    return "alloy";
  };
  const voice = resolveVoice(typeof clientVoice === "string" ? clientVoice : undefined);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "tts-1-hd",
      input,
      voice,
      format: "mp3",
    }),
    signal: controller.signal,
  });
  } catch {
    clearTimeout(timer);
    throw new ApiError(504, "TTS timeout");
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let errText = "";
    try {
      const j = await res.json();
      errText = j?.error?.message || JSON.stringify(j);
    } catch {}
    throw new ApiError(res.status, `OpenAI TTS: ${errText || res.statusText}`);
  }
  const arrayBuf = await res.arrayBuffer();
  const base64 = Buffer.from(arrayBuf).toString("base64");
  return base64;
}


