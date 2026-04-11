import { NextResponse } from "next/server";
import { cmsPost } from "@/lib/cms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// TODO: add Supabase session auth guard before production deployment
export async function POST(req: Request) {
  try {
    const { usr_id } = await req.json();
    if (!usr_id || typeof usr_id !== "number")
      return NextResponse.json({ ok: false, error: "usr_id required" }, { status: 400 });

    const data = await cmsPost<{ rating?: string; wtn?: string; data?: string }>(
      "mtt",
      "AdminMain",
      "updateTlinkTeamStatus",
      { usr_id }
    );

    const rating = data?.rating || data?.wtn || data?.data || null;
    return NextResponse.json({ ok: true, rating });
  } catch (e) {
    console.error("[mtt/actions/sync-wtn]", e);
    return NextResponse.json({ ok: false, error: "Failed to sync WTN rating." }, { status: 502 });
  }
}
