import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  try {
    const supabase = await getSupabaseServerClient();
    // Tente d'échanger explicitement le code si présent
    const url = new URL(_req.url);
    const code = url.searchParams.get("code");
    if (code) {
      // @ts-expect-error - La signature varie selon versions; on laisse Supabase gérer.
      await supabase.auth.exchangeCodeForSession(code);
    } else {
      await supabase.auth.exchangeCodeForSession();
    }
  } catch {}
  return NextResponse.redirect(new URL("/", process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"));
}


