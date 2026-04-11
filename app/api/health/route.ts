import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const checks = await Promise.all([
    getPool("mta").execute("SELECT 1").then(() => true).catch(() => false),
    getPool("mtt").execute("SELECT 1").then(() => true).catch(() => false),
  ]);

  const [mta, mtt] = checks;
  const status = mta && mtt ? "healthy" : mta || mtt ? "degraded" : "unhealthy";

  return NextResponse.json(
    { status, mta, mtt, timestamp: new Date().toISOString() },
    { status: 200 } // Always 200 so Vercel doesn't pull the instance
  );
}
