export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Body = {
  text?: string;
  lang?: string; // "fr" | "en" | ...
  apiKey?: string; // optional client-provided key
  voice?: string;
};

export async function POST(req: NextRequest) {
  try {
    const { text, lang = "fr", apiKey, voice } = (await req.json()) as Body;
    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return NextResponse.json({ error: "missing text" }, { status: 400 });
    }
    const key = apiKey || process.env.OPENAI_API_KEY;
    if (!key) return NextResponse.json({ error: "missing api key" }, { status: 401 });

    const audioBase64 = await ttsWithOpenAI(text.slice(0, 4000), key, voice);
    return NextResponse.json({ audio: audioBase64 }, { status: 200, headers: corsHeaders() });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: e instanceof ApiError ? e.status : 500, headers: corsHeaders() });
  }
}

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

async function ttsWithOpenAI(input: string, apiKey: string, clientVoice?: string): Promise<string> {
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
  const resolveVoice = (v?: string): string => (v && allowedVoices.has(v) ? v : "alloy");
  const voice = resolveVoice(clientVoice);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: "gpt-4o-mini-tts", input, voice, format: "mp3" }),
    });
    if (!res.ok) {
      let errText = "";
      try { errText = await res.text(); } catch {}
      throw new ApiError(res.status, errText || res.statusText);
    }
    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf).toString("base64");
  } finally {
    clearTimeout(timer);
  }
}


