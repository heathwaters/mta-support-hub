import { NextResponse } from "next/server";
import { query, cleanQ, escapeLike } from "@/lib/db";
import { requireAuth, type UserContext } from "@/lib/auth";
import { createAuditEvent, logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  const startTime = Date.now();

  const authResult = await requireAuth(req);
  if (authResult instanceof NextResponse) return authResult;
  const user: UserContext = authResult;

  const audit = createAuditEvent(req, user, requestId);

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
      usta_id: string;
      tournament_id: string;
      name: string;
      date_start: string;
      date_end: string;
      city: string;
      state: string;
      director: string;
    }>(
      "mta",
      `SELECT
         tourn_id AS id,
         tourn_usta_id AS usta_id,
         tournament_id AS tournament_id,
         tourn_name AS name,
         tourn_date_start AS date_start,
         tourn_date_end AS date_end,
         tourn_city AS city,
         tourn_state AS state,
         director
       FROM 2_Tournaments
       WHERE tourn_usta_id = ?
          OR tournament_id = ?
          OR tourn_name LIKE ?
       ORDER BY tourn_date_start DESC
       LIMIT 10`,
      [q, q, like]
    );

    const data = rows.map((r) => ({
      id: r.tournament_id || r.usta_id || String(r.id),
      name: r.name,
      dates: `${r.date_start} — ${r.date_end}`,
      loc: [r.city, r.state].filter(Boolean).join(", "),
      dir: r.director || "",
      link: r.tournament_id ? `https://www.matchtennisapp.com/baseapp/checkin?tid=${r.tournament_id}` : "",
    }));

    audit.responseStatus = 200;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);

    return NextResponse.json({ ok: true, data });
  } catch (e) {
    console.error("[mta/tournaments]", requestId, e);
    audit.responseStatus = 500;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);
    return NextResponse.json({ ok: false, error: "database error", code: "DATABASE_ERROR", ref: requestId }, { status: 500 });
  }
}
