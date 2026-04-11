import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAuth, ROLES, type UserContext } from "@/lib/auth";
import { createAuditEvent, logAudit } from "@/lib/audit";
import { checkRateLimit, classifyEndpoint } from "@/lib/rate-limit";
import { safeRequestId, parseJsonBody } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const requestId = safeRequestId(req.headers.get("x-request-id"));
  const startTime = Date.now();

  const authResult = await requireAuth(req, ROLES.SUPPORT_ADMIN);
  if (authResult instanceof NextResponse) return authResult;
  const user: UserContext = authResult;

  const rlCategory = classifyEndpoint(new URL(req.url).pathname, req.method);
  const rlResult = await checkRateLimit(user.id, rlCategory);
  if (rlResult) return rlResult;

  const audit = createAuditEvent(req, user, requestId);
  audit.action = "mta-update-tournament-phone";
  audit.piiAccessed = true;

  const parsed = await parseJsonBody(req);
  if (!parsed.data) {
    audit.responseStatus = 400;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);
    return NextResponse.json(
      { ok: false, error: parsed.error, code: "INVALID_JSON", ref: requestId },
      { status: ("status" in parsed && parsed.status) || 400 }
    );
  }

  const { tournId, phone } = parsed.data;

  if (typeof tournId !== "number" || !Number.isInteger(tournId) || tournId <= 0 || tournId > 2147483647) {
    audit.responseStatus = 400;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);
    return NextResponse.json(
      { ok: false, error: "tournId must be a positive integer", code: "VALIDATION_ERROR", ref: requestId },
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

  try {
    await query(
      "mta",
      "UPDATE `2_Tournaments` SET director_phone = ? WHERE tourn_id = ?",
      [cleaned, tournId]
    );

    audit.responseStatus = 200;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);

    return NextResponse.json({ ok: true, phone: cleaned, ref: requestId });
  } catch (e) {
    console.error(JSON.stringify({ type: "error", ref: requestId, endpoint: "mta/update-tournament-phone", msg: e instanceof Error ? e.message : String(e) }));
    audit.responseStatus = 500;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);
    return NextResponse.json(
      { ok: false, error: "database error", code: "DATABASE_ERROR", ref: requestId },
      { status: 500 }
    );
  }
}
