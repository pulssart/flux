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
      styleRef?: string;
    };
    const { title = "", summary = "", url = "", lang = "fr", apiKey = "", style: styleInput = "", styleRef = "" } = body;
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
    const ref = (styleRef || "").replace(/\s+/g, " ").trim().slice(0, 2000);
    const refBlockFr = ref ? `\n\nRéférence de style (ne PAS copier/recopier, s'en inspirer seulement): «${ref}».` : "";
    const refBlockEn = ref ? `\n\nStyle reference (do NOT copy verbatim, only mimic): “${ref}”.` : "";
    const sys = lang === "fr"
      ? `Tu écris un post pour X, style ${styleDesc}.${personalHintFr}${humorHintFr}${refBlockFr} Formate pour X (lignes courtes, aéré). N'inclus PAS d'URL ni d'emojis. Réponds uniquement par le texte du post.`
      : `You write an X post in a ${styleDesc} tone.${personalHintEn}${humorHintEn}${refBlockEn} Format for X (short lines, breathable). Do NOT include any URL or emojis. Reply with the post text only.`;
    const user = lang === "fr"
      ? `Titre: ${safeTitle}\nRésumé: ${safeSummary}\nContexte (ne pas inclure dans le post): ${safeUrl}\n\nRègles globales (tous styles):\n- Ton conversationnel: première personne, tutoiement/vouvoiement naturel; contractions ("j'ai", "t'es"); ok pour commencer par "Et"/"Mais" si ça sonne vrai.\n- Clarté: phrases courtes, vocabulaire simple; éviter le formalisme ("vérifier" plutôt que "déterminer l'existence de").\n- Variation de structure: alterner brèves et plus longues pour un bon rythme.\n- Anecdotes: quand pertinent, un cas vécu ou un exemple concret pour crédibiliser.\n- Opinions/émotions: enthousiasme mesuré, doutes, humour léger autorisés.\n- Touches perso/références: glisse parfois une remarque ou référence culturelle si naturel.\n- Métaphores originales: éviter comparaisons rebattues; créer des images propres.\n- Nuance/incertitude: 1 question rhétorique possible; admettre une limite si besoin.\n- Vocabulaire varié: remplacer clichés/mots trop fréquents ("révolutionnaire", "plonger dans").\n- Voix active et verbes concrets ("utiliser" > "utilisation de").\n- Relecture humaine: couper le superflu, simplifier, enlever répétitions/lourdeurs.\n- Évite les mots clichés ("plonger dans", "innombrables"). Préfère simple et précis.\n- Pas de politesse artificielle ("cher lecteur"). Reste direct et naturel.\n- Coupe les phrases trop longues en 2–3; supprime le remplissage ("en effet, il est important de noter que…").\n- Évite transitions génériques en boucle ("en conclusion", "par ailleurs"). Varie ou coupe.\n- Zéro hallucination: n'invente jamais chiffres, lieux, citations.\n- Pas d'analogies hasardeuses (ex: "c'est un peu comme un sprint").\n- Sème à l'occasion 1–2 mots d'argot courant si ça sonne naturel.\n\nAutres contraintes: 1) Respecte le style choisi 2) AUCUN lien 3) AUCUN emoji 4) Pas de hashtags inutiles 5) Français courant, lisible, lignes courtes 6) Micro‑fautes très subtiles possibles.`
      : `Title: ${safeTitle}\nSummary: ${safeSummary}\nContext (do not include in post): ${safeUrl}\n\nGlobal rules (all styles):\n- Conversational tone: first person, natural you/you plural; contractions (I'm, it's); okay to start with "And"/"But" if it sounds real.\n- Clarity: short sentences, simple words; avoid formalisms ("check" vs "determine the existence of").\n- Structure variety: mix short and longer sentences for rhythm.\n- Anecdotes: when relevant, add a real case or concrete example to build trust.\n- Opinions/emotions: measured enthusiasm, doubts, light humor.\n- Personal touches/culture refs when natural.\n- Original metaphors: avoid tired comparisons; craft your own images.\n- Nuance/uncertainty: 1 rhetorical question allowed; admit limits when needed.\n- Varied wording: replace clichés/overused words ("revolutionary", "dive into").\n- Active voice and concrete verbs ("use" > "use of").\n- Human edit pass: cut fluff, simplify, remove repetition/heaviness.\n- Avoid clichés ("countless"). Prefer simple and precise wording.\n- No artificial politeness ("dear reader"). Keep it direct and natural.\n- Split overly long sentences into 2–3; remove filler ("indeed, it is important to note that…").\n- Avoid generic transitions on loop ("in conclusion", "moreover"). Vary or cut.\n- No hallucinations: never invent numbers, places, quotes.\n- No strained analogies (e.g., "it's like a sprint").\n- Occasionally sprinkle 1–2 common slang words if it feels natural.\n\nOther constraints: 1) Respect the chosen style 2) NO link 3) NO emojis 4) No unnecessary hashtags 5) Plain, easy English with short lines 6) Tiny subtle natural mistakes are okay.`;

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
        max_tokens: 1024,
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
    return NextResponse.json({ text });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


