import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error) return NextResponse.json({ user: null }, { status: 200 });
  const user = data.user;
  const meta = (user?.user_metadata as { avatar_url?: string } | null) ?? null;
  return NextResponse.json(
    {
      user: user
        ? {
            id: user.id,
            email: user.email,
            avatar_url: meta?.avatar_url || null,
          }
        : null,
    },
    { status: 200 }
  );
  } catch {
    return NextResponse.json({ user: null }, { status: 200 });
  }
}


