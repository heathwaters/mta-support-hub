import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAuth, hasRole, ROLES, type UserContext } from "@/lib/auth";
import { createAuditEvent, logAudit } from "@/lib/audit";
import { checkRateLimit, classifyEndpoint } from "@/lib/rate-limit";
import { safeRequestId } from "@/lib/validate";
import { MTA_TYPE_LABELS, MTA_TYPE_LABEL_DEFAULT } from "@/lib/mta-constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const requestId = safeRequestId(req.headers.get("x-request-id"));
  const startTime = Date.now();

  // --- Auth ---
  const authResult = await requireAuth(req);
  if (authResult instanceof NextResponse) return authResult;
  const user: UserContext = authResult;

  const rlCategory = classifyEndpoint(new URL(req.url).pathname, req.method);
  const rlResult = await checkRateLimit(user.id, rlCategory);
  if (rlResult) return rlResult;

  const audit = createAuditEvent(req, user, requestId);
  audit.action = "mta-account";
  audit.piiAccessed = true;

  const canSeeFullPii = hasRole(user, ROLES.SUPPORT_ADMIN);

  const id = new URL(req.url).searchParams.get("id");
  if (!id || !/^\d+$/.test(id) || parseInt(id) > 2147483647) {
    audit.responseStatus = 400;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);
    return NextResponse.json({ ok: false, error: "id required", code: "VALIDATION_ERROR", ref: requestId }, { status: 400 });
  }

  try {
    const accounts = await query<{
      id: number; first: string; last: string; email: string; status: string;
      city: string; state: string; created: string | null; admin_note: string | null;
      register_status: number; reguser_type: number;
    }>(
      "mta",
      `SELECT reguser_id AS id, reguser_first AS first, reguser_last AS last,
         reguser_email AS email, reguser_status AS status,
         reguser_city AS city, reguser_state AS state,
         reguser_create_time AS created, reguser_admin_note AS admin_note,
         reguser_register_status AS register_status, reguser_type
       FROM regUser WHERE reguser_id = ? LIMIT 1`,
      [id]
    );

    if (accounts.length === 0) {
      audit.responseStatus = 404;
      audit.durationMs = Date.now() - startTime;
      await logAudit(audit);
      return NextResponse.json({ ok: false, error: "not found", code: "NOT_FOUND", ref: requestId }, { status: 404 });
    }
    const a = accounts[0];

    const usernameRows = await query<{ username: string }>(
      "mta",
      `SELECT reguser_username AS username FROM regUser WHERE reguser_id = ? LIMIT 1`,
      [id]
    ).catch(() => [] as { username: string }[]);

    const attempts = await query<{ c: number }>(
      "mta",
      `SELECT COUNT(*) AS c FROM login_attempts
       WHERE login_username = ? AND login_success = 0
         AND login_attempt_time > DATE_SUB(NOW(), INTERVAL 30 DAY)`,
      [a.email]
    ).catch(() => [{ c: 0 }]);

    audit.responseStatus = 200;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);

    return NextResponse.json({
      ok: true,
      ref: requestId,
      data: {
        id: a.id,
        name: `${a.first} ${a.last}`.trim(),
        email: canSeeFullPii ? a.email : "",
        username: usernameRows[0]?.username || "",
        status: a.status,
        role: MTA_TYPE_LABELS[a.reguser_type] || MTA_TYPE_LABEL_DEFAULT,
        city: canSeeFullPii ? a.city : "",
        state: canSeeFullPii ? a.state : "",
        created: a.created ?? null,
        verified: a.register_status === 1,
        adminNote: canSeeFullPii ? (a.admin_note || null) : null,
        attempts: attempts[0]?.c ?? 0,
      },
    });
  } catch (e) {
    console.error(JSON.stringify({ type: "error", ref: requestId, endpoint: "mta/account", msg: e instanceof Error ? e.message : String(e) }));
    audit.responseStatus = 500;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);
    return NextResponse.json({ ok: false, error: "database error", code: "DATABASE_ERROR", ref: requestId }, { status: 500 });
  }
}
