import { NextResponse } from "next/server";

// Cette route sert uniquement de placeholder si besoin d'un callback custom.
// Avec Supabase, le flux OAuth gère le callback côté Supabase et redirige vers NEXT_PUBLIC_SITE_URL
// que l'on va pointer sur http://localhost:3000 en local.

export async function GET() {
  return NextResponse.redirect(new URL("/", process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"));
}


