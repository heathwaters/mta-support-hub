import { NextResponse } from "next/server";
import { query, cleanQ, escapeLike } from "@/lib/db";
import { requireAuth, type UserContext } from "@/lib/auth";
import { createAuditEvent, logAudit } from "@/lib/audit";
import { safeRequestId } from "@/lib/validate";
import { checkRateLimit, classifyEndpoint } from "@/lib/rate-limit";
import { parseEventQuery } from "@/lib/query-parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const requestId = safeRequestId(req.headers.get("x-request-id"));
  const startTime = Date.now();

  const authResult = await requireAuth(req);
  if (authResult instanceof NextResponse) return authResult;
  const user: UserContext = authResult;

  // Rate limit: read (60/min)
  const rlCategory = classifyEndpoint(new URL(req.url).pathname, req.method);
  const rlResult = await checkRateLimit(user.id, rlCategory);
  if (rlResult) return rlResult;

  const audit = createAuditEvent(req, user, requestId);

  const q = cleanQ(new URL(req.url).searchParams.get("q"));
  if (!q) {
    audit.responseStatus = 400;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);
    return NextResponse.json({ ok: false, error: "q required (min 2 chars)", code: "VALIDATION_ERROR", ref: requestId }, { status: 400 });
  }

  try {
    const parsed = parseEventQuery(q);
    let where: string;
    let params: (string | number)[];

    switch (parsed.kind) {
      case "date":
        where = "? BETWEEN tourn_start_date AND tourn_end_date";
        params = [parsed.date];
        break;
      case "state":
        where = "tourn_state = ?";
        params = [parsed.code];
        break;
      case "section": {
        const placeholders = parsed.section.states.map(() => "?").join(",");
        if (parsed.section.titleFilter) {
          where = `tourn_state IN (${placeholders}) AND tourn_title REGEXP ?`;
          params = [...parsed.section.states, parsed.section.titleFilter.source];
        } else {
          where = `tourn_state IN (${placeholders})`;
          params = [...parsed.section.states];
        }
        break;
      }
      case "text": {
        const like = `%${escapeLike(parsed.value)}%`;
        where = "tourn_external_id = ? OR tourn_title LIKE ?";
        params = [parsed.value, like];
        break;
      }
    }

    const rows = await query<{
      id: number;
      external_id: string;
      title: string;
      state: string;
      start_date: string;
      end_date: string;
      reg_link: string;
      director: string;
      email: string;
      website: string;
    }>(
      "mtt",
      `SELECT
         tourn_id AS id,
         tourn_external_id AS external_id,
         tourn_title AS title,
         tourn_state AS state,
         tourn_start_date AS start_date,
         tourn_end_date AS end_date,
         tourn_reg_link AS reg_link,
         tourn_director AS director,
         tourn_email AS email,
         tourn_website AS website
       FROM tbltournaments
       WHERE ${where}
       ORDER BY tourn_start_date DESC
       LIMIT 15`,
      params
    );

    const data = rows.map((r) => ({
      id: r.id,
      name: r.title,
      state: r.state,
      dates: `${r.start_date} — ${r.end_date}`,
      link: r.reg_link || null,
      director: r.director || null,
      email: r.email || null,
      website: r.website || null,
    }));

    audit.responseStatus = 200;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);

    return NextResponse.json({ ok: true, data });
  } catch (e) {
    console.error(JSON.stringify({ type: "error", ref: requestId, endpoint: "mtt/events", msg: e instanceof Error ? e.message : String(e) }));
    audit.responseStatus = 500;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);
    return NextResponse.json({ ok: false, error: "database error", code: "DATABASE_ERROR", ref: requestId }, { status: 500 });
  }
}
