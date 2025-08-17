import { NextRequest, NextResponse } from "next/server";
import { parseFeed } from "@/lib/rss";
import { z } from "zod";

const BodySchema = z.object({
  url: z.string().url(),
});

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const { url } = BodySchema.parse(json);
    const parsed = await parseFeed(url, { fast: true, maxItems: 60, timeoutMs: 5000 });
    return NextResponse.json(parsed, { status: 200 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Erreur parsing feed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}


