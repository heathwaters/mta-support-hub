import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Fetches a user's teams and tournament registrations via direct MySQL
export async function GET(req: Request) {
  const url = new URL(req.url);
  const usrId = Number(url.searchParams.get("usr_id"));
  if (!usrId || !Number.isInteger(usrId) || usrId <= 0)
    return NextResponse.json({ ok: false, error: "usr_id required" }, { status: 400 });

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

    // Deduplicate plain teams (same team may appear multiple times from joins)
    const seenTeamIds = new Set(tournTeams.map((t) => t.team_id));
    const teams = rows
      .filter((r) => !r.tourn_id && !seenTeamIds.has(r.team_id))
      .reduce<typeof tournTeams>((acc, r) => {
        if (!acc.find((t) => t.team_id === r.team_id)) {
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
            is_registered: false,
            is_paid: false,
          });
        }
        return acc;
      }, []);

    return NextResponse.json({ ok: true, teams, tournTeams });
  } catch (e) {
    console.error("[mtt/teams]", e);
    return NextResponse.json({ ok: false, error: "Failed to load team data." }, { status: 500 });
  }
}
