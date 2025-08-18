import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      title?: string;
      summary?: string;
      url?: string;
      lang?: "fr" | "en";
      apiKey?: string;
      style?: string;
    };
    const { title = "", summary = "", url = "", lang = "fr", apiKey = "", style: styleInput = "" } = body;
    const trimmed = (s: string) => s.replace(/\s+/g, " ").trim();
    const safeTitle = trimmed(title).slice(0, 200);
    const safeSummary = trimmed(summary).slice(0, 1000);
    const safeUrl = trimmed(url);
    const style = String(styleInput || "casual").toLowerCase();
    const styleMapFr: Record<string, string> = {
      casual: "casual, naturel, registre parlé",
      concise: "très concis, phrases courtes",
      journalistic: "journalistique, neutre",
      analytical: "analytique, avec un insight",
      enthusiastic: "enthousiaste mais sobre, registre parlé",
      technical: "technique, clair, sans jargon inutile",
      humorous: "très personnel, humour léger et discret avec un twist sarcastique, registre parlé",
      formal: "formel, sérieux",
      very_personal: "très personnel, assumé, avis explicite, registre parlé",
    };
    const styleMapEn: Record<string, string> = {
      casual: "casual, natural, spoken register",
      concise: "very concise, short sentences",
      journalistic: "journalistic, neutral",
      analytical: "analytical, with an insight",
      enthusiastic: "enthusiastic but subtle, spoken register",
      technical: "technical, clear, no unnecessary jargon",
      humorous: "very personal, light humor with a subtle sarcastic twist, spoken register",
      formal: "formal, serious",
      very_personal: "very personal, explicit opinion, spoken register",
    };
    const styleDesc = (lang === "fr" ? styleMapFr : styleMapEn)[style] || (lang === "fr" ? styleMapFr.casual : styleMapEn.casual);
    const personalStyles = new Set(["casual", "enthusiastic", "humorous", "very_personal"]);
    const personalHintFr = personalStyles.has(style)
      ? " Utilise une voix personnelle (\"je\" ou \"on\" quand pertinent), des tournures naturelles, ellipses autorisées."
      : "";
    const personalHintEn = personalStyles.has(style)
      ? " Use a personal voice (first person or inclusive 'we' when relevant), natural phrasing; ellipses allowed."
      : "";
    const humorHintFr = style === "humorous" ? " Sarcasme très léger autorisé, sans méchanceté ni caricature." : "";
    const humorHintEn = style === "humorous" ? " Subtle sarcasm allowed, no meanness or caricature." : "";
    const sys = lang === "fr"
      ? `Tu écris un post pour X, style ${styleDesc}.${personalHintFr}${humorHintFr} Formate pour X (lignes courtes, sauts de ligne pour aérer si utile). NE PAS inclure d'URL ni d'emojis. Réponds uniquement par le texte du post.`
      : `You write an X post in a ${styleDesc} tone.${personalHintEn}${humorHintEn} Format for X (short lines, line breaks to improve readability when useful). DO NOT include any URL or emojis. Reply with the post text only.`;
    const maxChars = 280;
    const user = lang === "fr"
      ? `Titre: ${safeTitle}\nRésumé: ${safeSummary}\nContexte (ne pas inclure dans le post): ${safeUrl}\n\nContraintes: 1) ≤ ${maxChars} caractères (y compris sauts de ligne) 2) Style respecté 3) AUCUN lien 4) AUCUN emoji 5) Pas de hashtags inutiles 6) Français courant, facile à lire, lignes courtes et aération 7) Ne pose AUCUNE question 8) Introduis 1 ou 2 micro-fautes naturelles (orthographe/accord/pontuation très légères) pour un rendu plus humain.`
      : `Title: ${safeTitle}\nSummary: ${safeSummary}\nContext (do not include in post): ${safeUrl}\n\nConstraints: 1) ≤ ${maxChars} chars (including line breaks) 2) Respect the chosen style 3) NO link 4) NO emojis 5) No unnecessary hashtags 6) Plain, easy English with short lines and breathing space 7) Do NOT ask any question 8) Add 1–2 tiny, natural mistakes (spelling/grammar/punctuation, very subtle) to feel human.`;

    const key = process.env.OPENAI_API_KEY || apiKey;
    if (!key) return NextResponse.json({ error: "Missing OpenAI key" }, { status: 401 });

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        temperature: 0.7,
        max_tokens: 320,
      }),
    });
    let j: { choices?: Array<{ message?: { content?: string } }> } | null = null;
    try {
      j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    } catch {}
    if (!res.ok) {
      const errText = (
        j && typeof (j as { error?: { message?: string } }).error?.message === "string"
          ? ((j as { error?: { message?: string } }).error?.message as string)
          : await res.text().catch(() => "")
      );
      return NextResponse.json({ error: `OpenAI: ${errText || res.statusText}` }, { status: 400 });
    }
    if (!j) return NextResponse.json({ error: "No response" }, { status: 400 });
    const textRaw = j.choices?.[0]?.message?.content || "";
    let text = String(textRaw).replace(/^\s+|\s+$/g, "");
    // Nettoyage de sécurité: retirer les emojis si le modèle en a mis
    try {
      text = text
        .replace(/[\u200D\uFE0F]/g, "")
        .replace(/[\u{1F300}-\u{1FAFF}\u{1F600}-\u{1F64F}\u{2600}-\u{27BF}]/gu, "");
    } catch {}
    return NextResponse.json({ text: text.slice(0, maxChars) });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


