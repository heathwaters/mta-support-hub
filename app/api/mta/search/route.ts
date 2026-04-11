import { NextResponse } from "next/server";
import { query, cleanQ, escapeLike } from "@/lib/db";
import { requireAuth, hasRole, ROLES, type UserContext } from "@/lib/auth";
import { createAuditEvent, logAudit } from "@/lib/audit";
import { checkRateLimit, classifyEndpoint } from "@/lib/rate-limit";
import { safeRequestId } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function round2(n: number | null | undefined): string {
  if (n == null) return "";
  return String(Math.round(n * 100) / 100);
}

export async function GET(req: Request) {
  const requestId = safeRequestId(req.headers.get("x-request-id"));
  const startTime = Date.now();

  // --- Auth ---
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
    const parts = q.trim().split(/\s+/);
    const isMultiWord = parts.length >= 2;
    const firstLike = isMultiWord ? `%${escapeLike(parts[0])}%` : null;
    const lastLike = isMultiWord ? `%${escapeLike(parts.slice(1).join(" "))}%` : null;

    // 1. Account lookup — also find parent accounts linked to matching players
    const accounts = await query<{
      id: number; first: string; last: string; email: string; username: string | null; status: string;
      city: string; state: string; created: string | null; admin_note: string | null;
      register_status: number; reguser_type: number; reguser_sub_type: string;
    }>(
      "mta",
      `SELECT reguser_id AS id, reguser_first AS first, reguser_last AS last,
         reguser_email AS email, reguser_username AS username, reguser_status AS status,
         reguser_city AS city, reguser_state AS state,
         reguser_create_time AS created, reguser_admin_note AS admin_note,
         reguser_register_status AS register_status,
         reguser_type, reguser_sub_type
       FROM regUser
       WHERE reguser_email = ? OR reguser_email LIKE ?
          OR (reguser_first LIKE ? OR reguser_last LIKE ?)
          ${isMultiWord ? "OR (reguser_first LIKE ? AND reguser_last LIKE ?)" : ""}
          OR reguser_id IN (SELECT DISTINCT mpd_owner_id FROM myplayersdetail WHERE mpd_usta_no = ?)
          OR reguser_id IN (SELECT DISTINCT playerrel_usr_id FROM playerRelations WHERE playerrel_verify_id = ?)
          OR reguser_id IN (
            SELECT DISTINCT mpd_owner_id FROM myplayersdetail
            WHERE mpd_usta_no IN (
              SELECT usta_no FROM \`1_Players\`
              WHERE (player_first LIKE ? OR player_last LIKE ?)
              ${isMultiWord ? "OR (player_first LIKE ? AND player_last LIKE ?)" : ""}
            )
          )
          OR reguser_id IN (
            SELECT DISTINCT playerrel_usr_id FROM playerRelations
            WHERE playerrel_verify_id IN (
              SELECT usta_no FROM \`1_Players\`
              WHERE (player_first LIKE ? OR player_last LIKE ?)
              ${isMultiWord ? "OR (player_first LIKE ? AND player_last LIKE ?)" : ""}
            )
          )
       ORDER BY (reguser_email = ?) DESC, reguser_mod_time DESC
       LIMIT 10`,
      isMultiWord
        ? [q, like, like, like, firstLike!, lastLike!, q, q,
           like, like, firstLike!, lastLike!,
           like, like, firstLike!, lastLike!, q]
        : [q, like, like, like, q, q,
           like, like,
           like, like, q]
    );

    if (accounts.length === 0) {
      audit.responseStatus = 200;
      audit.durationMs = Date.now() - startTime;
      await logAudit(audit);
      return NextResponse.json({ ok: true, data: [] });
    }

    // Sort: direct name/email match first, then parent, then player, then others
    const qLower = q.toLowerCase();
    const nameMatch = (a: typeof accounts[0]) => {
      const full = `${a.first} ${a.last}`.toLowerCase();
      if (a.email.toLowerCase() === qLower) return 0;
      if (full === qLower) return 0;
      if (full.includes(qLower) || a.first.toLowerCase().includes(qLower) || a.last.toLowerCase().includes(qLower)) return 1;
      return 2;
    };
    // Player (1) last — managing accounts (Parent, Club Admin, Coach, TD, etc.) first
    const typePriority = (t: number) => t === 1 ? 1 : 0;
    accounts.sort((a, b) => {
      const matchDiff = nameMatch(a) - nameMatch(b);
      if (matchDiff !== 0) return matchDiff;
      return typePriority(a.reguser_type) - typePriority(b.reguser_type);
    });

    const top = accounts[0];

    // 2. Failed login attempts + 3. Players (parallel)
    const isUstaSearch = /^\d{7,}$/.test(q);

    const [attempts, players] = await Promise.all([
      query<{ c: number }>(
        "mta",
        `SELECT COUNT(*) AS c FROM login_attempts
         WHERE login_username = ? AND login_success = 0
           AND login_attempt_time > DATE_SUB(NOW(), INTERVAL 30 DAY)`,
        [top.email]
      ).catch(() => [{ c: 0 }]),

      query<{
        player_id: number; usta_no: string; first: string; last: string;
        section: string; district: string; age_group: string;
        city: string; state: string; country: string; gender: string;
        utr_singles: number; utr_doubles: string;
        wtn_singles: number; wtn_doubles: number;
        national_pts: number; national_rank: number;
        section_rank: number; district_rank: number;
        grad_year: number;
        relation: string;
      }>(
        "mta",
        isUstaSearch
          ? `SELECT p.player_id, p.usta_no, p.player_first AS first, p.player_last AS last,
               p.player_section AS section, p.player_district AS district,
               p.player_age_group AS age_group,
               p.player_city AS city, p.player_state AS state, p.player_country AS country,
               p.player_gender AS gender,
               p.utrSinglesDec AS utr_singles, p.utrDoubles AS utr_doubles,
               p.wtn_singles, p.wtn_doubles,
               p.player_national_pts AS national_pts, p.national_rank,
               p.section_rank, p.district_rank,
               p.player_grad_year AS grad_year,
               '' AS relation
             FROM \`1_Players\` p
             WHERE p.usta_no = ?
             LIMIT 20`
          : `SELECT p.player_id, p.usta_no, p.player_first AS first, p.player_last AS last,
               p.player_section AS section, p.player_district AS district,
               p.player_age_group AS age_group,
               p.player_city AS city, p.player_state AS state, p.player_country AS country,
               p.player_gender AS gender,
               p.utrSinglesDec AS utr_singles, p.utrDoubles AS utr_doubles,
               p.wtn_singles, p.wtn_doubles,
               p.player_national_pts AS national_pts, p.national_rank,
               p.section_rank, p.district_rank,
               p.player_grad_year AS grad_year,
               COALESCE(pr.playerrel_relation, 'following') AS relation
             FROM \`1_Players\` p
             LEFT JOIN playerRelations pr
               ON pr.playerrel_verify_id = p.usta_no
               AND pr.playerrel_usr_id = ?
             WHERE p.usta_no IN (
                 SELECT mpd_usta_no FROM myplayersdetail WHERE mpd_owner_id = ? AND mpd_usta_no != ''
               )
                OR p.usta_no IN (
                 SELECT playerrel_verify_id FROM playerRelations
                 WHERE playerrel_usr_id = ?
               )
             LIMIT 20`,
        isUstaSearch ? [q] : [top.id, top.id, top.id]
      ).catch(() => []),
    ]);

    // 4. Waivers + 5. Relations (parallel, depend on players)
    const ustaNumbers = [...new Set(players.map(p => p.usta_no).filter(Boolean))];

    const [allWaivers, relations, hasActiveReset, directorTournaments, savedPlayers] = await Promise.all([
      ustaNumbers.length > 0
        ? query<{
            tourn_db_id: number; tourn_name: string; tourn_id: string; tourn_usta_id: string; tournament_id: string;
            tourn_state: string; director: string; director_email: string; director_phone: string;
            event: string; utr: number; wtn: number; player_usta: string;
            player_first: string; player_last: string;
            start_date: string; end_date: string;
          }>(
            "mta",
            `SELECT t.tourn_id AS tourn_db_id, t.tourn_name, a.tourn_id AS tourn_id,
               t.tourn_usta_id, t.tournament_id AS tournament_id,
               t.tourn_state, t.director, t.director_email, t.director_phone,
               a.applicant_event AS event, a.applicant_utr AS utr, a.applicant_wtn AS wtn,
               a.applicant_usta AS player_usta, a.applicant_first AS player_first,
               a.applicant_last AS player_last,
               t.tourn_date_start AS start_date, t.tourn_date_end AS end_date
             FROM \`3_Tournament_Applicants\` a
             LEFT JOIN \`2_Tournaments\` t ON t.tourn_usta_id = a.tourn_id
             WHERE a.applicant_usta IN (${ustaNumbers.map(() => "?").join(",")})
               AND t.tourn_date_start >= DATE_SUB(NOW(), INTERVAL 2 YEAR)
             ORDER BY t.tourn_date_start DESC`,
            ustaNumbers
          ).catch(() => [])
        : Promise.resolve([]),

      ustaNumbers.length > 0
        ? query<{
            id: number; name: string; email: string; city: string; state: string;
            relation: string; status: string;
          }>(
            "mta",
            `(SELECT r.reguser_id AS id, CONCAT(r.reguser_first, ' ', r.reguser_last) AS name,
                r.reguser_email AS email, r.reguser_city AS city, r.reguser_state AS state,
                pr.playerrel_relation AS relation, r.reguser_status AS status
              FROM playerRelations pr
              JOIN regUser r ON r.reguser_id = pr.playerrel_usr_id
              WHERE pr.playerrel_verify_id IN (${ustaNumbers.map(() => "?").join(",")})
              GROUP BY r.reguser_id, pr.playerrel_relation)
             UNION ALL
             (SELECT r.reguser_id AS id, CONCAT(r.reguser_first, ' ', r.reguser_last) AS name,
                r.reguser_email AS email, r.reguser_city AS city, r.reguser_state AS state,
                'my players' AS relation, r.reguser_status AS status
              FROM myplayersdetail m
              JOIN regUser r ON r.reguser_id = m.mpd_owner_id
              WHERE m.mpd_usta_no IN (${ustaNumbers.map(() => "?").join(",")})
              GROUP BY r.reguser_id)
             LIMIT 15`,
            [...ustaNumbers, ...ustaNumbers]
          ).catch(() => [])
        : Promise.resolve([]),

      // Only check if reset token EXISTS — never return the actual token/code
      query<{ c: number }>(
        "mta",
        `SELECT COUNT(*) AS c FROM tblLivePasswordResetCodes
         WHERE prc_email = ? AND prc_used = 0 AND prc_expires_at > NOW()`,
        [top.email]
      ).then(rows => (rows[0]?.c ?? 0) > 0).catch(() => false),

      // 6. Tournaments directed by this account (for TD accounts)
      top.reguser_type === 3
        ? query<{
            id: number; usta_id: string; tournament_id: string;
            name: string; date_start: string; date_end: string;
            city: string; state: string;
          }>(
            "mta",
            `SELECT tourn_id AS id, tourn_usta_id AS usta_id, tournament_id,
               tourn_name AS name, tourn_date_start AS date_start, tourn_date_end AS date_end,
               tourn_city AS city, tourn_state AS state
             FROM \`2_Tournaments\`
             WHERE director_email = ?
             ORDER BY tourn_date_start DESC
             LIMIT 20`,
            [top.email]
          ).catch(() => [])
        : Promise.resolve([]),

      // 7. Saved player+division: get raw playerRelations then match in 1_Players
      (async () => {
        try {
          const rels = await query<{ pid: number; usta: string; relation: string }>(
            "mta",
            `SELECT playerrel_player_id AS pid, playerrel_verify_id AS usta, playerrel_relation AS relation
             FROM playerRelations WHERE playerrel_usr_id = ?`,
            [top.id]
          );
          if (rels.length === 0) return { entries: [] as { usta: string; div: string; relation: string }[], dbg: "0 rels" };

          // Build relation map: usta -> relation (use first found)
          const relMap = new Map<string, string>();
          for (const r of rels) {
            if (r.usta && !relMap.has(r.usta)) relMap.set(r.usta, r.relation || "");
          }

          const pids = rels.map(r => r.pid).filter(Boolean);
          let matched: { usta: string; div: string }[] = [];

          if (pids.length > 0) {
            matched = await query<{ usta: string; div: string }>(
              "mta",
              `SELECT usta_no AS usta, player_age_group AS div FROM \`1_Players\`
               WHERE player_id IN (${pids.map(() => "?").join(",")})`,
              pids
            ).catch(() => []);
          }

          if (matched.length > 0) {
            return { entries: matched.map(m => ({ ...m, relation: relMap.get(m.usta) || "" })), dbg: `${rels.length} rels, ${matched.length} matched` };
          }

          return {
            entries: rels.map(r => ({ usta: r.usta, div: "", relation: r.relation || "" })),
            dbg: `${rels.length} rels, fallback`,
          };
        } catch (e) {
          return { entries: [] as { usta: string; div: string }[], dbg: "err:" + (e instanceof Error ? e.message : String(e)) };
        }
      })(),
    ]);

    const now = new Date().toISOString().split("T")[0];
    const completedWaivers = allWaivers.filter(w => !w.start_date || w.start_date < now);
    const upcomingTournaments = allWaivers.filter(w => w.start_date && w.start_date >= now);

    // 8. For TD accounts: fetch waiver applicants for their upcoming tournaments
    const upcomingDirected = directorTournaments.filter(t => t.date_start && t.date_start >= now);
    const directedUstaIds = upcomingDirected.map(t => t.usta_id).filter(Boolean);
    const tournamentApplicants = directedUstaIds.length > 0
      ? await query<{
          tourn_id: string; player_usta: string; player_first: string; player_last: string;
          event: string;
        }>(
          "mta",
          `SELECT a.tourn_id, a.applicant_usta AS player_usta,
             a.applicant_first AS player_first, a.applicant_last AS player_last,
             a.applicant_event AS event
           FROM \`3_Tournament_Applicants\` a
           WHERE a.tourn_id IN (${directedUstaIds.map(() => "?").join(",")})
           ORDER BY a.applicant_last, a.applicant_first`,
          directedUstaIds
        ).catch(() => [])
      : [];

    // 8b. Find draw/match entries who have NOT completed waiver
    // Check both tourn_matches and Matches_Participants for entry data
    const [drawFromMatches, drawFromParticipants] = directedUstaIds.length > 0
      ? await Promise.all([
          query<{ tourn_id: string; usta: string; first: string; last: string; event: string }>(
            "mta",
            `SELECT DISTINCT tm.tournmatch_evtorg_id AS tourn_id,
               CAST(tm.tournmatch_player_id AS CHAR) AS usta,
               tm.tournmatch_first AS first, tm.tournmatch_last AS last,
               tm.tournmatch_evt AS event
             FROM tourn_matches tm
             WHERE tm.tournmatch_evtorg_id IN (${directedUstaIds.map(() => "?").join(",")})`,
            directedUstaIds
          ).catch(() => []),
          query<{ tourn_id: string; usta: string }>(
            "mta",
            `SELECT DISTINCT matchpart_tourn_id AS tourn_id,
               CAST(matchpart_playerusta_id AS CHAR) AS usta
             FROM Matches_Participants
             WHERE matchpart_tourn_id IN (${directedUstaIds.map(() => "?").join(",")})
               AND matchpart_playerusta_id > 0`,
            directedUstaIds
          ).catch((e) => { console.error("[mp-query]", e instanceof Error ? e.message : e); return []; }),
        ])
      : [[], []];

    console.log("[notCompleted-debug] directedUstaIds:", directedUstaIds.length, "drawFromMatches:", drawFromMatches.length, "drawFromParticipants:", drawFromParticipants.length);

    // Merge unique USTAs per tournament from both sources (normalize tourn_id to lowercase)
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

    // For USTAs from Matches_Participants without names, look up from 1_Players
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

    // Diff: entries that have no matching applicant = waiver not completed
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
    // Sort not-completed by last name
    for (const [, arr] of notCompletedByTourn) {
      arr.sort((a, b) => a.last.localeCompare(b.last) || a.first.localeCompare(b.first));
    }

    // Determine if user can see full PII
    const canSeeFullPii = hasRole(user, ROLES.SUPPORT_ADMIN);

    const MTA_TYPE_LABELS: Record<number, string> = {
      1: "Player",
      2: "Parent",
      3: "Tournament Director",
      4: "Coach",
      5: "Club Admin",
      6: "Section Admin",
      7: "District Admin",
      10: "Super Admin",
    };

    const result = accounts.map((a, i) => ({
      id: a.id,
      name: `${a.first} ${a.last}`.trim(),
      email: a.email,
      username: a.username || "",
      status: a.status,
      role: MTA_TYPE_LABELS[a.reguser_type] || "Player",
      city: a.city,
      state: a.state,
      created: a.created ?? null,
      verified: a.register_status === 1,
      adminNote: canSeeFullPii ? (a.admin_note || null) : null,
      attempts: i === 0 ? attempts[0]?.c ?? 0 : 0,
      hasActiveReset: i === 0 ? hasActiveReset : false,
      players:
        i === 0
          ? players.map((p) => ({
              playerId: p.player_id,
              name: `${p.first} ${p.last}`.trim(),
              usta: p.usta_no || "",
              section: p.section || "",
              district: p.district || "",
              div: p.age_group || "",
              city: p.city || "",
              state: p.state || "",
              country: p.country || "",
              gender: p.gender || "",
              gradYear: p.grad_year || "",
              utrSingles: round2(p.utr_singles),
              utrDoubles: p.utr_doubles || "",
              wtnSingles: round2(p.wtn_singles),
              wtnDoubles: round2(p.wtn_doubles),
              nationalPts: p.national_pts || 0,
              nationalRank: p.national_rank || 0,
              sectionRank: p.section_rank || 0,
              districtRank: p.district_rank || 0,
              relation: (p.relation || "").toLowerCase().includes("parent") ? "parent" : "following",
            }))
          : [],
      upcoming: i === 0 ? upcomingTournaments.map((w) => ({
        tournId: w.tourn_db_id,
        ustaId: w.tourn_usta_id || "",
        tournName: w.tourn_name || "(unknown)",
        event: w.event,
        playerUsta: w.player_usta,
        dates: w.start_date && w.end_date ? `${w.start_date} — ${w.end_date}` : w.start_date || "",
        director: w.director || "",
        directorEmail: w.director_email || "",
        directorPhone: w.director_phone || "",
        link: w.tournament_id ? `https://www.matchtennisapp.com/baseapp/checkin?tid=${w.tournament_id}` : "",
      })) : [],
      waivers: i === 0 ? completedWaivers.map((w) => ({
        tournId: w.tourn_db_id,
        tournName: w.tourn_name || "(unknown)",
        event: w.event,
        playerUsta: w.player_usta,
        dates: w.start_date && w.end_date ? `${w.start_date} — ${w.end_date}` : "",
        director: w.director || "",
        directorEmail: w.director_email || "",
        directorPhone: w.director_phone || "",
      })) : [],
      relations: i === 0 ? relations.map((r) => ({
        id: r.id,
        name: r.name?.trim(),
        email: canSeeFullPii ? r.email : "",
        city: canSeeFullPii ? r.city : "",
        state: canSeeFullPii ? r.state : "",
        relation: r.relation,
        status: r.status,
      })) : [],
      directedTournaments: i === 0 ? directorTournaments.map((t) => {
        const now = new Date().toISOString().split("T")[0];
        return {
          id: t.usta_id || "",
          name: t.name,
          dates: t.date_start && t.date_end ? `${t.date_start} — ${t.date_end}` : t.date_start || "",
          loc: [t.city, t.state].filter(Boolean).join(", "),
          upcoming: t.date_start >= now,
          link: t.tournament_id ? `https://www.matchtennisapp.com/baseapp/checkin?tid=${t.tournament_id}` : "",
          ustaLink: t.usta_id ? `https://playtennis.usta.com/competitions/${t.usta_id}` : "",
          applicants: t.date_start >= now && t.usta_id
            ? tournamentApplicants
                .filter(a => a.tourn_id === t.usta_id)
                .map(a => ({
                  usta: a.player_usta,
                  name: `${a.player_first} ${a.player_last}`.trim(),
                  event: a.event,
                  completed: true,
                }))
            : [],
          notCompleted: t.date_start >= now && t.usta_id
            ? (notCompletedByTourn.get(t.usta_id) || []).map(d => ({
                usta: d.usta,
                name: `${d.first} ${d.last}`.trim(),
                event: d.event,
              }))
            : [],
        };
      }) : [],
      savedDivisions: i === 0 ? savedPlayers.entries.map(sp => ({
        usta: sp.usta,
        div: sp.div || "",
        relation: sp.relation || "",
      })) : [],
    }));

    audit.responseStatus = 200;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);

    return NextResponse.json({ ok: true, data: result });
  } catch (e) {
    console.error(JSON.stringify({ type: "error", ref: requestId, endpoint: "mta/search", msg: e instanceof Error ? e.message : String(e) }));
    audit.responseStatus = 500;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);
    return NextResponse.json({ ok: false, error: "database error", code: "DATABASE_ERROR", ref: requestId }, { status: 500 });
  }
}
