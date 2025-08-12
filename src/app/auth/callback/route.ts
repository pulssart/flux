import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const origin = (process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin).replace(/\/$/, "");
  const redirectUrl = new URL("/", origin);
  try {
    const supabase = await getSupabaseServerClient();
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    if (code) {
      await supabase.auth.exchangeCodeForSession(code);
    }
  } catch {
    // ignore et on redirige quand même
  }
  return NextResponse.redirect(redirectUrl);
}


