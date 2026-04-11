import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAuth, type UserContext } from "@/lib/auth";
import { createAuditEvent, logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  const startTime = Date.now();

  // --- Auth ---
  const authResult = await requireAuth(req);
  if (authResult instanceof NextResponse) return authResult;
  const user: UserContext = authResult;

  const audit = createAuditEvent(req, user, requestId);
  audit.piiAccessed = true;

  const id = new URL(req.url).searchParams.get("id");
  if (!id || !/^\d+$/.test(id) || parseInt(id) > 2147483647) {
    audit.responseStatus = 400;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);
    return NextResponse.json({ ok: false, error: "id required", code: "VALIDATION_ERROR", ref: requestId }, { status: 400 });
  }

  try {
    const MTA_TYPE_LABELS: Record<number, string> = {
      1: "Player", 2: "Parent", 3: "Tournament Director", 4: "Coach",
      5: "Club Admin", 6: "Section Admin", 7: "District Admin", 10: "Super Admin",
    };

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
      data: {
        id: a.id,
        name: `${a.first} ${a.last}`.trim(),
        email: a.email,
        username: usernameRows[0]?.username || "",
        status: a.status,
        role: MTA_TYPE_LABELS[a.reguser_type] || "Player",
        city: a.city,
        state: a.state,
        created: a.created ?? null,
        verified: a.register_status === 1,
        adminNote: a.admin_note || null,
        attempts: attempts[0]?.c ?? 0,
      },
    });
  } catch (e) {
    console.error("[mta/account]", requestId, e);
    audit.responseStatus = 500;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);
    return NextResponse.json({ ok: false, error: "database error", code: "DATABASE_ERROR", ref: requestId }, { status: 500 });
  }
}
