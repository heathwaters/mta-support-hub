import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Public endpoint — provides Supabase config to the login page (before auth)
export function GET() {
  return NextResponse.json({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
  });
}
