import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAuth, ROLES, type UserContext } from "@/lib/auth";
import { createAuditEvent, logAudit } from "@/lib/audit";
import { checkRateLimit, classifyEndpoint } from "@/lib/rate-limit";
import { safeRequestId, parseJsonBody, isValidUsrId } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AGE_GROUP_MAX = 32;
const RELATION_MAX = 32;

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
  audit.action = "mta-add-division";
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

  const { ownerId, ustaNo, ageGroup, relation } = parsed.data;

  if (!isValidUsrId(ownerId)) {
    audit.responseStatus = 400;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);
    return NextResponse.json(
      { ok: false, error: "ownerId must be a positive integer", code: "VALIDATION_ERROR", ref: requestId },
      { status: 400 }
    );
  }

  if (typeof ustaNo !== "string" || !/^\d{5,}$/.test(ustaNo)) {
    audit.responseStatus = 400;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);
    return NextResponse.json(
      { ok: false, error: "valid ustaNo required", code: "VALIDATION_ERROR", ref: requestId },
      { status: 400 }
    );
  }

  if (typeof ageGroup !== "string" || ageGroup.length === 0 || ageGroup.length > AGE_GROUP_MAX) {
    audit.responseStatus = 400;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);
    return NextResponse.json(
      { ok: false, error: "ageGroup must be a non-empty string", code: "VALIDATION_ERROR", ref: requestId },
      { status: 400 }
    );
  }

  const relationStr = typeof relation === "string" && relation.length > 0 && relation.length <= RELATION_MAX
    ? relation
    : null;

  audit.targetUserId = ownerId;

  try {
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
      return NextResponse.json({ ok: true, message: "Division already exists", ref: requestId });
    }

    await query(
      "mta",
      `INSERT INTO myplayersdetail (mpd_owner_id, mpd_usta_no, mpd_age_group)
       VALUES (?, ?, ?)`,
      [ownerId, ustaNo, ageGroup]
    );

    if (relationStr !== null) {
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
          [ownerId, ustaNo, relationStr]
        );
      }
    }

    audit.responseStatus = 200;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);

    return NextResponse.json({ ok: true, message: "Division added", ref: requestId });
  } catch (e) {
    console.error(JSON.stringify({ type: "error", ref: requestId, endpoint: "mta/add-division", msg: e instanceof Error ? e.message : String(e) }));
    audit.responseStatus = 500;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);
    return NextResponse.json(
      { ok: false, error: "database error", code: "DATABASE_ERROR", ref: requestId },
      { status: 500 }
    );
  }
}
