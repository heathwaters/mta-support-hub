import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAuth, type UserContext } from "@/lib/auth";
import { createAuditEvent, logAudit } from "@/lib/audit";
import { checkRateLimit, classifyEndpoint } from "@/lib/rate-limit";
import { safeRequestId } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mtt/teams?usr_id=<int>
 *
 * Fetches a user's teams and tournament registrations via direct MySQL join.
 * Returns two arrays: `tournTeams` (teams tied to a tournament) and `teams`
 * (plain teams with no tournament). Plain teams are deduplicated because the
 * LEFT JOINs against tournaments and participation can emit the same team row
 * multiple times. The legacy CMS stored the co-captain role as both
 * `"co-captain"` and `"cocaptain"`; both spellings are treated as co-captain.
 */
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
  audit.action = "mtt-teams";
  audit.piiAccessed = true;

  const url = new URL(req.url);
  const usrIdRaw = url.searchParams.get("usr_id");
  const usrId = Number(usrIdRaw);
  if (!usrIdRaw || !Number.isInteger(usrId) || usrId <= 0) {
    audit.responseStatus = 400;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);
    return NextResponse.json(
      { ok: false, error: "usr_id must be a positive integer", code: "VALIDATION_ERROR", ref: requestId },
      { status: 400 }
    );
  }

  audit.targetUserId = usrId;

  try {
    // Get all teams + tournament info for this user
    const rows = await query<{
      team_name: string;
      team_id: number;
      team_status: string;
      member_user_type: string;
      member_title: string;
      tourn_id: number | null;
      tourn_title: string | null;
      tourn_state: string | null;
      tourn_start_date: string | null;
      tourn_end_date: string | null;
      tourn_reg_link: string | null;
      tourn_director: string | null;
      tourn_email: string | null;
      tourn_website: string | null;
      tournpart_id: number | null;
      tournpart_amt_paid: number | null;
      tournpart_price: number | null;
    }>(
      "mtt",
      `SELECT
         t.team_name, t.team_id, t.team_status,
         m.member_user_type, m.member_title,
         tn.tourn_id, tn.tourn_title, tn.tourn_state,
         tn.tourn_start_date, tn.tourn_end_date, tn.tourn_reg_link,
         tn.tourn_director, tn.tourn_email, tn.tourn_website,
         tp.tournpart_id, tp.tournpart_amt_paid, tp.tournpart_price
       FROM tblteam_members m
       JOIN tblteams t ON t.team_id = m.member_team_id
       LEFT JOIN tbltournteams tt ON tt.tournteam_team_id = t.team_id
       LEFT JOIN tbltournaments tn ON tn.tourn_id = tt.tournteam_tourn_id
       LEFT JOIN tbltourn_participation tp
         ON tp.tournpart_usr_id = m.member_usr_id
         AND tp.tournpart_tourn_id = tn.tourn_id
         AND tp.tournpart_team_id = t.team_id
       WHERE m.member_usr_id = ?
       ORDER BY tn.tourn_start_date DESC`,
      [usrId]
    );

    // Split into tournament teams (have a tournament) and plain teams (no tournament)
    const tournTeams = rows
      .filter((r) => r.tourn_id)
      .map((r) => ({
        team_name: r.team_name,
        team_id: r.team_id,
        role: r.member_user_type || "athlete",
        title: r.member_title || "",
        is_captain: r.member_user_type === "captain",
        is_co_captain: r.member_user_type === "co-captain" || r.member_user_type === "cocaptain",
        tourn_id: r.tourn_id,
        tourn_title: r.tourn_title,
        tourn_state: r.tourn_state,
        tourn_start_date: r.tourn_start_date,
        tourn_end_date: r.tourn_end_date,
        tourn_reg_link: r.tourn_reg_link,
        tourn_director: r.tourn_director,
        tourn_email: r.tourn_email,
        tourn_website: r.tourn_website,
        is_registered: r.tournpart_id != null,
        is_paid: r.tournpart_id != null && (
          (r.tournpart_price ?? 0) === 0 ||
          (r.tournpart_amt_paid ?? 0) >= (r.tournpart_price ?? 0)
        ),
      }));

    // Deduplicate plain teams. Two dedup sources: (1) teams that also appear
    // in tournTeams are excluded via `seenTeamIds`; (2) plain-plain duplicates
    // (same team row emitted multiple times by the LEFT JOIN cartesian product)
    // are collapsed via `seenPlainIds`. Both checks are O(1) Set lookups so
    // the whole reduce is O(n) rather than O(n²).
    const seenTeamIds = new Set(tournTeams.map((t) => t.team_id));
    const seenPlainIds = new Set<number>();
    const teams = rows
      .filter((r) => !r.tourn_id && !seenTeamIds.has(r.team_id))
      .reduce<typeof tournTeams>((acc, r) => {
        if (!seenPlainIds.has(r.team_id)) {
          seenPlainIds.add(r.team_id);
          acc.push({
            team_name: r.team_name,
            team_id: r.team_id,
            role: r.member_user_type || "athlete",
            title: r.member_title || "",
            is_captain: r.member_user_type === "captain",
            is_co_captain: r.member_user_type === "co-captain" || r.member_user_type === "cocaptain",
            tourn_id: null,
            tourn_title: null,
            tourn_state: null,
            tourn_start_date: null,
            tourn_end_date: null,
            tourn_reg_link: null,
            tourn_director: null,
            tourn_email: null,
            tourn_website: null,
            is_registered: false,
            is_paid: false,
          });
        }
        return acc;
      }, []);

    audit.responseStatus = 200;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);

    return NextResponse.json({ ok: true, teams, tournTeams, ref: requestId });
  } catch (e) {
    console.error(JSON.stringify({ type: "error", ref: requestId, endpoint: "mtt/teams", msg: e instanceof Error ? e.message : String(e) }));
    audit.responseStatus = 500;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);
    return NextResponse.json(
      { ok: false, error: "Failed to load team data.", code: "DATABASE_ERROR", ref: requestId },
      { status: 500 }
    );
  }
}
