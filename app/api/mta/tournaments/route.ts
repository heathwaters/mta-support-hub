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

  const rlCategory = classifyEndpoint(new URL(req.url).pathname, req.method);
  const rlResult = await checkRateLimit(user.id, rlCategory);
  if (rlResult) return rlResult;

  const audit = createAuditEvent(req, user, requestId);
  audit.action = "mta-tournaments";

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
       FROM \`2_Tournaments\`
       WHERE tourn_usta_id = ?
          OR tournament_id = ?
          OR tourn_name LIKE ?
       ORDER BY tourn_date_start DESC
       LIMIT 10`,
      [q, q, like]
    );

    // Fetch waiver applicants for returned tournaments
    const ustaIds = rows.map((r) => r.usta_id).filter(Boolean);
    const tournamentApplicants = ustaIds.length > 0
      ? await query<{
          tourn_id: string; player_usta: string; player_first: string; player_last: string;
          event: string;
        }>(
          "mta",
          `SELECT a.tourn_id, a.applicant_usta AS player_usta,
             a.applicant_first AS player_first, a.applicant_last AS player_last,
             a.applicant_event AS event
           FROM \`3_Tournament_Applicants\` a
           WHERE a.tourn_id IN (${ustaIds.map(() => "?").join(",")})
           ORDER BY a.applicant_last, a.applicant_first`,
          ustaIds
        ).catch(() => [])
      : [];

    // Find draw/match entries who have NOT completed waiver
    const [drawFromMatches, drawFromParticipants] = ustaIds.length > 0
      ? await Promise.all([
          query<{ tourn_id: string; usta: string; first: string; last: string; event: string }>(
            "mta",
            `SELECT DISTINCT tm.tournmatch_evtorg_id AS tourn_id,
               CAST(tm.tournmatch_player_id AS CHAR) AS usta,
               tm.tournmatch_first AS first, tm.tournmatch_last AS last,
               tm.tournmatch_evt AS event
             FROM tourn_matches tm
             WHERE tm.tournmatch_evtorg_id IN (${ustaIds.map(() => "?").join(",")})`,
            ustaIds
          ).catch(() => []),
          query<{ tourn_id: string; usta: string }>(
            "mta",
            `SELECT DISTINCT matchpart_tourn_id AS tourn_id,
               CAST(matchpart_playerusta_id AS CHAR) AS usta
             FROM Matches_Participants
             WHERE matchpart_tourn_id IN (${ustaIds.map(() => "?").join(",")})
               AND matchpart_playerusta_id > 0`,
            ustaIds
          ).catch(() => []),
        ])
      : [[], []];

    // Merge unique USTAs per tournament from both sources
    const allEntryUstasByTourn = new Map<string, Set<string>>();
    for (const d of [...drawFromMatches, ...drawFromParticipants]) {
      const tid = d.tourn_id.toLowerCase();
      if (!allEntryUstasByTourn.has(tid)) allEntryUstasByTourn.set(tid, new Set());
      allEntryUstasByTourn.get(tid)!.add(d.usta);
    }

    // Build name lookup from drawFromMatches
    const nameByUsta = new Map<string, { first: string; last: string; event: string }>();
    for (const d of drawFromMatches) {
      if (!nameByUsta.has(d.usta)) nameByUsta.set(d.usta, { first: d.first, last: d.last, event: d.event });
    }

    // Look up names for Matches_Participants entries without names
    const missingNameUstas = [...new Set(drawFromParticipants.map(d => d.usta))].filter(u => !nameByUsta.has(u));
    if (missingNameUstas.length > 0) {
      const playerNames = await query<{ usta_no: string; first: string; last: string; age_group: string }>(
        "mta",
        `SELECT usta_no, player_first AS first, player_last AS last, player_age_group AS age_group
         FROM \`1_Players\`
         WHERE usta_no IN (${missingNameUstas.map(() => "?").join(",")})
         GROUP BY usta_no`,
        missingNameUstas
      ).catch(() => []);
      for (const p of playerNames) {
        if (!nameByUsta.has(p.usta_no)) nameByUsta.set(p.usta_no, { first: p.first, last: p.last, event: p.age_group });
      }
    }

    // Diff: entries with no matching applicant = waiver not completed
    const completedUstasByTourn = new Map<string, Set<string>>();
    for (const a of tournamentApplicants) {
      if (!completedUstasByTourn.has(a.tourn_id)) completedUstasByTourn.set(a.tourn_id, new Set());
      completedUstasByTourn.get(a.tourn_id)!.add(String(a.player_usta));
    }
    type NotCompletedEntry = { usta: string; first: string; last: string; event: string };
    const notCompletedByTourn = new Map<string, NotCompletedEntry[]>();
    for (const [tournId, ustas] of allEntryUstasByTourn) {
      const completed = completedUstasByTourn.get(tournId);
      for (const usta of ustas) {
        if (!completed || !completed.has(usta)) {
          if (!notCompletedByTourn.has(tournId)) notCompletedByTourn.set(tournId, []);
          const name = nameByUsta.get(usta);
          notCompletedByTourn.get(tournId)!.push({
            usta,
            first: name?.first || "",
            last: name?.last || "",
            event: name?.event || "",
          });
        }
      }
    }
    for (const [, arr] of notCompletedByTourn) {
      arr.sort((a, b) => a.last.localeCompare(b.last) || a.first.localeCompare(b.first));
    }

    const data = rows.map((r) => ({
      id: r.tournament_id || r.usta_id || String(r.id),
      name: r.name,
      dates: `${r.date_start} — ${r.date_end}`,
      loc: [r.city, r.state].filter(Boolean).join(", "),
      dir: r.director || "",
      link: r.tournament_id ? `https://www.matchtennisapp.com/baseapp/checkin?tid=${r.tournament_id}` : "",
      ustaLink: r.usta_id ? `https://playtennis.usta.com/competitions/${r.usta_id}` : "",
      applicants: r.usta_id
        ? tournamentApplicants
            .filter(a => a.tourn_id === r.usta_id)
            .map(a => ({
              usta: a.player_usta,
              name: `${a.player_first} ${a.player_last}`.trim(),
              event: a.event,
            }))
        : [],
      notCompleted: r.usta_id
        ? (notCompletedByTourn.get(r.usta_id.toLowerCase()) || []).map(d => ({
            usta: d.usta,
            name: `${d.first} ${d.last}`.trim(),
            event: d.event,
          }))
        : [],
    }));

    audit.responseStatus = 200;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);

    return NextResponse.json({ ok: true, data, ref: requestId });
  } catch (e) {
    console.error(JSON.stringify({ type: "error", ref: requestId, endpoint: "mta/tournaments", msg: e instanceof Error ? e.message : String(e) }));
    audit.responseStatus = 500;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);
    return NextResponse.json({ ok: false, error: "database error", code: "DATABASE_ERROR", ref: requestId }, { status: 500 });
  }
}
