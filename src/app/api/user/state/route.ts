import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type FeedInfo = { id: string; title: string; url: string };
type FolderInfo = { id: string; title: string; feedIds: string[]; collapsed?: boolean };

export async function GET() {
  const supabase = await getSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user?.user) return NextResponse.json({ feeds: [], folders: [], preferences: {} }, { status: 200 });
  const { data, error } = await supabase
    .from("user_state")
    .select("feeds, folders, preferences")
    .eq("user_id", user.user.id)
    .single();
  if (error || !data) return NextResponse.json({ feeds: [], folders: [], preferences: {} }, { status: 200 });
  return NextResponse.json({ feeds: data.feeds ?? [], folders: data.folders ?? [], preferences: data.preferences ?? {} }, { status: 200 });
}

export async function POST(req: NextRequest) {
  const supabase = await getSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as {
    feeds?: FeedInfo[];
    folders?: FolderInfo[];
    preferences?: Record<string, unknown>;
  };
  // Lire l'état actuel pour fusionner si besoin (mise à jour partielle)
  const { data: existing } = await supabase
    .from("user_state")
    .select("feeds, folders, preferences")
    .eq("user_id", user.user.id)
    .single();

  const feeds = Array.isArray(body.feeds) ? body.feeds : (existing?.feeds ?? []);
  const folders = Array.isArray(body.folders) ? body.folders : (existing?.folders ?? []);
  const preferences =
    body.preferences && typeof body.preferences === "object"
      ? { ...(existing?.preferences ?? {}), ...body.preferences }
      : (existing?.preferences ?? {});

  const payload = {
    user_id: user.user.id,
    feeds,
    folders,
    preferences,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("user_state").upsert(payload, { onConflict: "user_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true }, { status: 200 });
}


