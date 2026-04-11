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
  audit.piiAccessed = true;

  try {
    const body = await req.json();
    const { tournId, phone } = body as { tournId?: unknown; phone?: unknown };

    const tid = Number(tournId);
    if (!Number.isInteger(tid) || tid <= 0 || tid > 2147483647) {
      audit.responseStatus = 400;
      audit.durationMs = Date.now() - startTime;
      await logAudit(audit);
      return NextResponse.json(
        { ok: false, error: "valid tournId required", code: "VALIDATION_ERROR", ref: requestId },
        { status: 400 }
      );
    }

    if (typeof phone !== "string") {
      audit.responseStatus = 400;
      audit.durationMs = Date.now() - startTime;
      await logAudit(audit);
      return NextResponse.json(
        { ok: false, error: "phone must be a string", code: "VALIDATION_ERROR", ref: requestId },
        { status: 400 }
      );
    }

    const cleaned = phone.replace(/[^\d+\-() .]/g, "").trim().slice(0, 32);

    await query(
      "mta",
      "UPDATE `2_Tournaments` SET director_phone = ? WHERE tourn_id = ?",
      [cleaned, tid]
    );

    audit.responseStatus = 200;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);

    return NextResponse.json({ ok: true, phone: cleaned });
  } catch (e) {
    console.error("[mta/update-tournament-phone]", requestId, e);
    audit.responseStatus = 500;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);
    return NextResponse.json(
      { ok: false, error: "database error", code: "DATABASE_ERROR", ref: requestId },
      { status: 500 }
    );
  }
}
