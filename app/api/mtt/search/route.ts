import { NextResponse } from "next/server";
import { query, cleanQ, escapeLike } from "@/lib/db";
import { requireAuth, type UserContext } from "@/lib/auth";
import { createAuditEvent, logAudit } from "@/lib/audit";
import { checkRateLimit, classifyEndpoint } from "@/lib/rate-limit";
import { safeRequestId } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const requestId = safeRequestId(req.headers.get("x-request-id"));
  const startTime = Date.now();

  const authResult = await requireAuth(req);
  if (authResult instanceof NextResponse) return authResult;
  const user: UserContext = authResult;

  // Rate limit: search (30/min)
  const rlCategory = classifyEndpoint(new URL(req.url).pathname, req.method);
  const rlResult = await checkRateLimit(user.id, rlCategory);
  if (rlResult) return rlResult;

  const audit = createAuditEvent(req, user, requestId);
  audit.piiAccessed = true;

  const q = cleanQ(new URL(req.url).searchParams.get("q"));
  if (!q) {
    audit.responseStatus = 400;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);
    return NextResponse.json({ ok: false, error: "q required (min 2 chars)", code: "VALIDATION_ERROR", ref: requestId }, { status: 400 });
  }

  try {
    const like = `%${escapeLike(q)}%`;
    const rows = await query<{
      id: number;
      first: string;
      last: string;
      email: string;
      t_shirt_size: string;
      wtn_singles: number;
      wtn_doubles: number;
      city: string;
      state: string;
      active_status: string;
      contact_type: string;
      usr_type_id: number;
    }>(
      "mtt",
      `SELECT
         usr_id AS id,
         f_name AS first,
         l_name AS last,
         email,
         t_shirt_size,
         wtn_singles,
         wtn_doubles,
         city,
         state,
         active_status,
         contact_type,
         usr_type_id
       FROM tblprofile
       WHERE email = ?
          OR email LIKE ?
          OR CONCAT(f_name, ' ', l_name) LIKE ?
          OR f_name LIKE ?
          OR l_name LIKE ?
       ORDER BY (email = ?) DESC, profile_update_date DESC
       LIMIT 10`,
      [q, like, like, like, like, q]
    );

    if (rows.length === 0) {
      audit.responseStatus = 200;
      audit.durationMs = Date.now() - startTime;
      await logAudit(audit);
      return NextResponse.json({ ok: true, data: [] });
    }

    const top = rows[0];

    // Fetch usernames separately (column may not exist in all environments)
    const mttUsernames = await query<{ id: number; username: string }>(
      "mtt",
      `SELECT usr_id AS id, username FROM tblprofile
       WHERE usr_id IN (${rows.map(() => "?").join(",")})`,
      rows.map(r => r.id)
    ).catch(() => [] as { id: number; username: string }[]);
    const mttUsernameMap = new Map(mttUsernames.map(u => [u.id, u.username]));

    const attempts = await query<{ c: number }>(
      "mtt",
      `SELECT COUNT(*) AS c FROM login_attempts
       WHERE login_username = ? AND login_success = 0
         AND login_attempt_time > DATE_SUB(NOW(), INTERVAL 30 DAY)`,
      [top.email]
    ).catch(() => [{ c: 0 }]);

    const MTT_ROLE_LABELS: Record<string, string> = {
      "org-admin": "Org Admin",
      "org-admin-site": "Site Admin",
      "captain": "Captain",
      "coach": "Coach",
      "athlete": "Player",
      "player": "Player",
      "parent": "Parent",
      "administrator": "Administrator",
      "team-admin": "Team Admin",
      "camper": "Camper",
      "camperparent": "Camper Parent",
      "clubathlete": "Club Athlete",
      "clubparent": "Club Parent",
      "fan": "Fan",
    };

    const data = rows.map((r, i) => ({
      id: r.id,
      name: `${r.first} ${r.last}`.trim(),
      email: r.email,
      username: mttUsernameMap.get(r.id) || "",
      status: r.active_status || "unknown",
      role: MTT_ROLE_LABELS[r.contact_type] || r.contact_type || "Player",
      attempts: i === 0 ? attempts[0]?.c ?? 0 : 0,
      city: r.city,
      state: r.state,
      players: [
        {
          name: `${r.first} ${r.last}`.trim(),
          usta: "",
          div: "",
          wtnSingles: r.wtn_singles ? String(r.wtn_singles) : "",
          ntrp: "",
          shirt: r.t_shirt_size || "",
        },
      ],
    }));

    audit.responseStatus = 200;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);

    return NextResponse.json({ ok: true, data });
  } catch (e) {
    console.error(JSON.stringify({ type: "error", ref: requestId, endpoint: "mtt/search", msg: e instanceof Error ? e.message : String(e) }));
    audit.responseStatus = 500;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);
    return NextResponse.json({ ok: false, error: "database error", code: "DATABASE_ERROR", ref: requestId }, { status: 500 });
  }
}
