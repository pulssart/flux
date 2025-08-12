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
    };
    const { title = "", summary = "", url = "", lang = "fr", apiKey = "" } = body;
    const trimmed = (s: string) => s.replace(/\s+/g, " ").trim();
    const safeTitle = trimmed(title).slice(0, 200);
    const safeSummary = trimmed(summary).slice(0, 1000);
    const safeUrl = trimmed(url);
    const sys = lang === "fr"
      ? "Tu écris un post pour X, style conversationnel, simple, naturel. NE PAS inclure d'URL ni d'emojis. Réponds uniquement par le texte du post."
      : "You write an X post in a conversational, simple, casual tone. DO NOT include any URL or emojis. Reply with the post text only.";
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
      const errText = (j as any)?.error?.message || (await res.text().catch(() => ""));
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


