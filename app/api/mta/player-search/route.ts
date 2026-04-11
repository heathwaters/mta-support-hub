import { NextResponse } from "next/server";
import { query, cleanQ, escapeLike } from "@/lib/db";
import { requireAuth, hasRole, ROLES, type UserContext } from "@/lib/auth";
import { createAuditEvent, logAudit } from "@/lib/audit";
import { checkRateLimit, classifyEndpoint } from "@/lib/rate-limit";
import { safeRequestId } from "@/lib/validate";
import { MTA_TYPE_LABELS, MTA_TYPE_LABEL_DEFAULT } from "@/lib/mta-constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function round2(n: number | null | undefined): string {
  if (n == null) return "";
  return String(Math.round(n * 100) / 100);
}

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
  audit.action = "mta-player-search";
  audit.piiAccessed = true;

  const canSeeFullPii = hasRole(user, ROLES.SUPPORT_ADMIN);

  const q = cleanQ(new URL(req.url).searchParams.get("q"));
  if (!q) {
    audit.responseStatus = 400;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);
    return NextResponse.json(
      { ok: false, error: "q required (min 2 chars)", code: "VALIDATION_ERROR", ref: requestId },
      { status: 400 }
    );
  }

  try {
    const isUstaSearch = /^\d{7,}$/.test(q);
    const like = `%${escapeLike(q)}%`;
    const parts = q.trim().split(/\s+/);
    const isMultiWord = parts.length >= 2;
    const firstLike = isMultiWord ? `%${escapeLike(parts[0])}%` : null;
    const lastLike = isMultiWord ? `%${escapeLike(parts.slice(1).join(" "))}%` : null;

    const playerSelect = `SELECT
        p.usta_no,
        MAX(p.player_first) AS first,
        MAX(p.player_last) AS last,
        MAX(p.player_section) AS section,
        MAX(p.player_district) AS district,
        MAX(p.player_city) AS city,
        MAX(p.player_state) AS state,
        MAX(p.player_gender) AS gender,
        MAX(p.utrSinglesDec) AS utr_singles,
        MAX(p.wtn_singles) AS wtn_singles,
        MAX(p.player_grad_year) AS grad_year,
        GROUP_CONCAT(DISTINCT p.player_age_group ORDER BY p.player_age_group SEPARATOR ',') AS divisions`;

    const players = await query<{
      usta_no: string; first: string; last: string;
      section: string; district: string;
      city: string; state: string; gender: string;
      utr_singles: number; wtn_singles: number;
      grad_year: number;
      divisions: string;
    }>(
      "mta",
      isUstaSearch
        ? `${playerSelect}
           FROM \`1_Players\` p
           WHERE p.usta_no = ?
           GROUP BY p.usta_no
           LIMIT 25`
        : isMultiWord
          ? `${playerSelect}
             FROM \`1_Players\` p
             WHERE (p.player_first LIKE ? AND p.player_last LIKE ?)
                OR (p.player_first LIKE ? OR p.player_last LIKE ?)
             GROUP BY p.usta_no
             ORDER BY MAX(CASE WHEN p.player_first LIKE ? AND p.player_last LIKE ? THEN 1 ELSE 0 END) DESC,
                      MAX(p.player_last), MAX(p.player_first)
             LIMIT 25`
          : `${playerSelect}
             FROM \`1_Players\` p
             WHERE p.player_first LIKE ? OR p.player_last LIKE ?
             GROUP BY p.usta_no
             ORDER BY MAX(p.player_last), MAX(p.player_first)
             LIMIT 25`,
      isUstaSearch
        ? [q]
        : isMultiWord
          ? [firstLike!, lastLike!, like, like, firstLike!, lastLike!]
          : [like, like]
    );

    if (players.length === 0) {
      audit.responseStatus = 200;
      audit.durationMs = Date.now() - startTime;
      await logAudit(audit);
      return NextResponse.json({ ok: true, data: [] });
    }

    const ustaNumbers = [...new Set(players.map(p => p.usta_no).filter(Boolean))];

    // Linked accounts: union of playerRelations (parent/coach links) and myplayersdetail (saved players).
    // Each row carries the usta_no it links to, so we can group on the client side of this function.
    const linked = ustaNumbers.length > 0
      ? await query<{
          id: number; first: string; last: string; email: string; status: string;
          reguser_type: number; city: string; state: string;
          relation: string; usta_no: string;
        }>(
          "mta",
          `SELECT r.reguser_id AS id, r.reguser_first AS first, r.reguser_last AS last,
              r.reguser_email AS email, r.reguser_status AS status,
              r.reguser_type, r.reguser_city AS city, r.reguser_state AS state,
              pr.playerrel_relation AS relation, pr.playerrel_verify_id AS usta_no
            FROM playerRelations pr
            JOIN regUser r ON r.reguser_id = pr.playerrel_usr_id
            WHERE pr.playerrel_verify_id IN (${ustaNumbers.map(() => "?").join(",")})
           UNION
           SELECT r.reguser_id AS id, r.reguser_first AS first, r.reguser_last AS last,
              r.reguser_email AS email, r.reguser_status AS status,
              r.reguser_type, r.reguser_city AS city, r.reguser_state AS state,
              'my players' AS relation, m.mpd_usta_no AS usta_no
            FROM myplayersdetail m
            JOIN regUser r ON r.reguser_id = m.mpd_owner_id
            WHERE m.mpd_usta_no IN (${ustaNumbers.map(() => "?").join(",")})`,
          [...ustaNumbers, ...ustaNumbers]
        ).catch(() => [])
      : [];

    // Group linked accounts by usta_no, deduping (id, usta_no) pairs and preferring a non-empty relation.
    const accountsByUsta = new Map<string, Map<number, {
      id: number; name: string; email: string; status: string; role: string;
      city: string; state: string; relation: string;
    }>>();
    for (const row of linked) {
      if (!row.usta_no || !row.id) continue;
      if (!accountsByUsta.has(row.usta_no)) accountsByUsta.set(row.usta_no, new Map());
      const bucket = accountsByUsta.get(row.usta_no)!;
      const existing = bucket.get(row.id);
      const next = {
        id: row.id,
        name: `${row.first || ""} ${row.last || ""}`.trim(),
        email: canSeeFullPii ? row.email : "",
        status: row.status,
        role: MTA_TYPE_LABELS[row.reguser_type] || MTA_TYPE_LABEL_DEFAULT,
        city: canSeeFullPii ? (row.city || "") : "",
        state: canSeeFullPii ? (row.state || "") : "",
        relation: row.relation || "",
      };
      if (!existing || (!existing.relation && next.relation && next.relation !== "my players")) {
        bucket.set(row.id, next);
      }
    }

    const data = players.map(p => ({
      ustaNo: p.usta_no,
      name: `${p.first || ""} ${p.last || ""}`.trim(),
      first: p.first || "",
      last: p.last || "",
      section: p.section || "",
      district: p.district || "",
      divisions: p.divisions ? p.divisions.split(",").filter(Boolean) : [],
      city: p.city || "",
      state: p.state || "",
      gender: p.gender || "",
      utrSingles: round2(p.utr_singles),
      wtnSingles: round2(p.wtn_singles),
      gradYear: p.grad_year || "",
      linkedAccounts: Array.from(accountsByUsta.get(p.usta_no)?.values() || []),
    }));

    audit.responseStatus = 200;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);

    return NextResponse.json({ ok: true, data, ref: requestId });
  } catch (e) {
    console.error(JSON.stringify({ type: "error", ref: requestId, endpoint: "mta/player-search", msg: e instanceof Error ? e.message : String(e) }));
    audit.responseStatus = 500;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);
    return NextResponse.json(
      { ok: false, error: "database error", code: "DATABASE_ERROR", ref: requestId },
      { status: 500 }
    );
  }
}
