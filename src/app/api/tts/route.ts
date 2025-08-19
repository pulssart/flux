// TTS désactivé
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
  return NextResponse.json({ error: "TTS disabled" }, { status: 410, headers: corsHeaders() });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
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
  // Timeout un peu plus long, mais attention aux limites Netlify Functions
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: "tts-1-hd", input, voice, format: "mp3" }),
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


