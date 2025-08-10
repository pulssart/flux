import { NextRequest, NextResponse } from "next/server";
import { discoverFeedOrThrow } from "@/lib/discover";

export async function POST(req: NextRequest) {
  try {
    const { url, timeoutMs } = await req.json();
    if (typeof url !== "string") {
      return NextResponse.json({ error: "Paramètre 'url' requis" }, { status: 400 });
    }
    const result = await discoverFeedOrThrow(url, typeof timeoutMs === "number" ? timeoutMs : 20_000);
    return NextResponse.json(result, { status: 200 });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}


