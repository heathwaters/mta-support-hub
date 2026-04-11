import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAuth, type UserContext } from "@/lib/auth";
import { createAuditEvent, logAudit } from "@/lib/audit";
import { safeRequestId } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const requestId = safeRequestId(req.headers.get("x-request-id"));
  const startTime = Date.now();

  const authResult = await requireAuth(req);
  if (authResult instanceof NextResponse) return authResult;
  const user: UserContext = authResult;

  const audit = createAuditEvent(req, user, requestId);

  try {
    const body = await req.json();
    const { ownerId, ustaNo, ageGroup, relation } = body;

    if (!ownerId || !ustaNo || !ageGroup) {
      audit.responseStatus = 400;
      audit.durationMs = Date.now() - startTime;
      await logAudit(audit);
      return NextResponse.json(
        { ok: false, error: "ownerId, ustaNo, and ageGroup required", code: "VALIDATION_ERROR", ref: requestId },
        { status: 400 }
      );
    }

    // Check if already exists
    const existing = await query<{ c: number }>(
      "mta",
      `SELECT COUNT(*) AS c FROM myplayersdetail
       WHERE mpd_owner_id = ? AND mpd_usta_no = ? AND mpd_age_group = ?`,
      [ownerId, ustaNo, ageGroup]
    );

    if (existing[0]?.c > 0) {
      audit.responseStatus = 200;
      audit.durationMs = Date.now() - startTime;
      await logAudit(audit);
      return NextResponse.json({ ok: true, message: "Division already exists" });
    }

    // Insert into myplayersdetail
    await query(
      "mta",
      `INSERT INTO myplayersdetail (mpd_owner_id, mpd_usta_no, mpd_age_group)
       VALUES (?, ?, ?)`,
      [ownerId, ustaNo, ageGroup]
    );

    // If relation specified, ensure playerRelations entry exists
    if (relation) {
      const relExists = await query<{ c: number }>(
        "mta",
        `SELECT COUNT(*) AS c FROM playerRelations
         WHERE playerrel_usr_id = ? AND playerrel_verify_id = ?`,
        [ownerId, ustaNo]
      );

      if (relExists[0]?.c === 0) {
        await query(
          "mta",
          `INSERT INTO playerRelations (playerrel_usr_id, playerrel_verify_id, playerrel_relation)
           VALUES (?, ?, ?)`,
          [ownerId, ustaNo, relation]
        );
      }
    }

    audit.responseStatus = 200;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);

    return NextResponse.json({ ok: true, message: "Division added" });
  } catch (e) {
    console.error("[mta/add-division]", requestId, e);
    audit.responseStatus = 500;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);
    return NextResponse.json(
      { ok: false, error: "database error", code: "DATABASE_ERROR", ref: requestId },
      { status: 500 }
    );
  }
}
