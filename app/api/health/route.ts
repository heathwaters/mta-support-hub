import { NextResponse } from "next/server";
import { mtaPool, mttPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const checks = await Promise.all([
    mtaPool.execute("SELECT 1").then(() => true).catch(() => false),
    mttPool.execute("SELECT 1").then(() => true).catch(() => false),
  ]);

  const [mta, mtt] = checks;
  const status = mta && mtt ? "healthy" : mta || mtt ? "degraded" : "unhealthy";

  return NextResponse.json(
    { status, mta, mtt, timestamp: new Date().toISOString() },
    { status: 200 } // Always 200 so Vercel doesn't pull the instance
  );
}
