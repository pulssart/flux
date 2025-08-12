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
      casual: "casual, naturel",
      concise: "très concis, phrases courtes",
      journalistic: "journalistique, neutre",
      analytical: "analytique, avec un insight",
      enthusiastic: "enthousiaste mais sobre",
      technical: "technique, clair, sans jargon inutile",
      humorous: "humour léger et discret",
      formal: "formel, sérieux",
    };
    const styleMapEn: Record<string, string> = {
      casual: "casual, natural",
      concise: "very concise, short sentences",
      journalistic: "journalistic, neutral",
      analytical: "analytical, with an insight",
      enthusiastic: "enthusiastic but subtle",
      technical: "technical, clear, no unnecessary jargon",
      humorous: "light, discreet humor",
      formal: "formal, serious",
    };
    const styleDesc = (lang === "fr" ? styleMapFr : styleMapEn)[style] || (lang === "fr" ? styleMapFr.casual : styleMapEn.casual);
    const sys = lang === "fr"
      ? `Tu écris un post pour X, style ${styleDesc}. NE PAS inclure d'URL ni d'emojis. Réponds uniquement par le texte du post.`
      : `You write an X post in a ${styleDesc} tone. DO NOT include any URL or emojis. Reply with the post text only.`;
    const user = lang === "fr"
      ? `Titre: ${safeTitle}\nRésumé: ${safeSummary}\nContexte (ne pas inclure dans le post): ${safeUrl}\n\nContraintes: 1) ≤ 240 caractères 2) Ton casual, facile à lire, sans jargon 3) AUCUN lien 4) AUCUN emoji 5) Pas de hashtags inutiles.`
      : `Title: ${safeTitle}\nSummary: ${safeSummary}\nContext (do not include in post): ${safeUrl}\n\nConstraints: 1) ≤ 240 chars 2) Casual, easy-to-read tone, no jargon 3) NO link 4) NO emojis 5) No unnecessary hashtags.`;

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
        max_tokens: 160,
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
    return NextResponse.json({ text: text.slice(0, 280) });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


