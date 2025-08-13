import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const DAILY_TOKENS = 30;

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET() {
  const supabase = await getSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user?.user) return NextResponse.json({ left: DAILY_TOKENS, date: todayStr() }, { status: 200 });

  const d = todayStr();
  const { data, error } = await supabase
    .from("ai_tokens")
    .select("tokens_left, date")
    .eq("user_id", user.user.id)
    .eq("date", d)
    .single();

  if (error || !data) {
    // Retourner la valeur par défaut sans créer la ligne (création paresseuse à la première écriture)
    return NextResponse.json({ left: DAILY_TOKENS, date: d }, { status: 200 });
  }

  let left = DAILY_TOKENS;
  const rowMaybe = data as unknown;
  if (
    rowMaybe &&
    typeof rowMaybe === "object" &&
    typeof (rowMaybe as { tokens_left?: unknown }).tokens_left === "number"
  ) {
    const v = (rowMaybe as { tokens_left: number }).tokens_left;
    left = Math.max(0, Math.min(DAILY_TOKENS, v));
  }
  return NextResponse.json({ left, date: d }, { status: 200 });
}

export async function POST(req: NextRequest) {
  const supabase = await getSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { op?: "consume" | "set" | "reset"; value?: number };
  const op = body.op || "consume";
  const d = todayStr();

  const { data: existing } = await supabase
    .from("ai_tokens")
    .select("tokens_left, date")
    .eq("user_id", user.user.id)
    .eq("date", d)
    .single();

  let left = DAILY_TOKENS;
  const existingRow = existing as unknown;
  if (
    existingRow &&
    typeof existingRow === "object" &&
    typeof (existingRow as { tokens_left?: unknown }).tokens_left === "number"
  ) {
    left = (existingRow as { tokens_left: number }).tokens_left;
  }

  if (op === "reset") {
    left = DAILY_TOKENS;
  } else if (op === "set") {
    const v = typeof body.value === "number" ? body.value : DAILY_TOKENS;
    left = Math.max(0, Math.min(DAILY_TOKENS, v));
  } else {
    // consume (par défaut 1)
    const dec = typeof body.value === "number" ? body.value : 1;
    left = Math.max(0, Math.min(DAILY_TOKENS, left - Math.max(0, dec)));
  }

  const payload = {
    user_id: user.user.id,
    date: d,
    tokens_left: left,
    updated_at: new Date().toISOString(),
  };

  // upsert sur (user_id, date)
  const { error } = await supabase
    .from("ai_tokens")
    .upsert(payload, { onConflict: "user_id,date" });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ left, date: d }, { status: 200 });
}


