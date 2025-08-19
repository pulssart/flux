import { ApiError } from "./api-error";

const MAX_RETRIES = 2;
const BASE_TIMEOUT = 25000;
const RETRY_DELAY = 2000;

type OpenAIOptions = {
  timeoutMs?: number;
  retries?: number;
  model?: string;
};

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: OpenAIOptions = {}
): Promise<Response> {
  const maxRetries = options.retries ?? MAX_RETRIES;
  const timeoutMs = options.timeoutMs ?? BASE_TIMEOUT;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs + (attempt * 5000)); // Augmente le timeout à chaque retry
    
    try {
      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      // Retry sur les erreurs 429 (rate limit) et 500-504
      if (!res.ok && (res.status === 429 || (res.status >= 500 && res.status <= 504)) && attempt < maxRetries) {
        clearTimeout(timer);
        const delay = RETRY_DELAY * (attempt + 1); // Délai exponentiel
        await sleep(delay);
        continue;
      }

      return res;
    } catch (e) {
      clearTimeout(timer);
      if (attempt === maxRetries) throw e;
      if (e instanceof Error && e.name === "AbortError") {
        await sleep(RETRY_DELAY * (attempt + 1));
        continue;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error("Max retries exceeded");
}

export async function generateText(
  prompt: string,
  input: string,
  apiKey: string,
  options: OpenAIOptions = {}
): Promise<string> {
  const model = options.model || "gpt-5-nano";
  
  const res = await fetchWithRetry(
    "https://api.openai.com/v1/responses",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: `${prompt}\n\n${input}`,
      }),
    },
    options
  );

  if (!res.ok) {
    let errText = "";
    try {
      const j = await res.json();
      errText = j?.error?.message || JSON.stringify(j);
    } catch {}
    throw new ApiError(res.status, `OpenAI ${model}: ${errText || res.statusText}`);
  }

  const json = await res.json();
  const text = extractTextFromResponses(json);
  if (!text) {
    throw new ApiError(502, `Empty model response: ${JSON.stringify({
      keys: Object.keys(json || {}),
      preview: JSON.stringify(json)?.slice(0, 300),
    })}`);
  }

  return text.trim();
}

const CHUNK_SIZE = 4000; // ~3-4 minutes de TTS

export async function generateSpeech(
  text: string,
  voice: string,
  apiKey: string,
  options: OpenAIOptions = {}
): Promise<string[]> {
  // Découper le texte en chunks pour éviter les timeouts
  const chunks = splitTextIntoChunks(text, CHUNK_SIZE);
  const audioChunks: string[] = [];

  for (const chunk of chunks) {
    const res = await fetchWithRetry(
      "https://api.openai.com/v1/audio/speech",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "tts-1-hd",
          input: chunk,
          voice,
          format: "mp3",
        }),
      },
      { ...options, timeoutMs: Math.min(30000, (chunk.length / 20) * 100) } // ~100ms par 20 caractères
    );

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
    audioChunks.push(base64);
  }

  return audioChunks;
}

function splitTextIntoChunks(text: string, maxSize: number): string[] {
  const chunks: string[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  let currentChunk = "";

  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > maxSize) {
      if (currentChunk) chunks.push(currentChunk.trim());
      currentChunk = sentence;
    } else {
      currentChunk += (currentChunk ? " " : "") + sentence;
    }
  }

  if (currentChunk) chunks.push(currentChunk.trim());
  return chunks;
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
