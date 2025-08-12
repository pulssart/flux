import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnon) {
      return NextResponse.json(
        { error: "Server env missing: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY" },
        { status: 500 }
      );
    }

    const supabase = await getSupabaseServerClient();
    const site = process.env.NEXT_PUBLIC_SITE_URL?.trim();
    const origin = (site && site.length > 0 ? site : req.headers.get("origin") || req.nextUrl.origin).replace(/\/$/, "");
    const redirectTo = `${origin}/auth/callback`;

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    });
    if (error) {
      return NextResponse.json({ error: error.message, redirectTo }, { status: 400 });
    }
    return NextResponse.json({ url: data?.url, redirectTo });
  } catch (e) {
    console.error("/api/auth/login failed", e);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}


