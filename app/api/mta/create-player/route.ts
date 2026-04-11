import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAuth, type UserContext } from "@/lib/auth";
import { createAuditEvent, logAudit } from "@/lib/audit";
import { safeRequestId } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const requestId = safeRequestId(req.headers.get("x-request-id"));
  const startTime = Date.now();

  const authResult = await requireAuth(req);
  if (authResult instanceof NextResponse) return authResult;
  const user: UserContext = authResult;

  const audit = createAuditEvent(req, user, requestId);

  try {
    const body = await req.json();
    const { ustaNo, ageGroup, ownerId, relation } = body;

    if (!ustaNo || !ageGroup) {
      audit.responseStatus = 400;
      audit.durationMs = Date.now() - startTime;
      await logAudit(audit);
      return NextResponse.json(
        { ok: false, error: "ustaNo and ageGroup required", code: "VALIDATION_ERROR", ref: requestId },
        { status: 400 }
      );
    }

    // Check if this player+division already exists
    const existing = await query<{ c: number }>(
      "mta",
      `SELECT COUNT(*) AS c FROM \`1_Players\` WHERE usta_no = ? AND player_age_group = ?`,
      [ustaNo, ageGroup]
    );

    if (existing[0]?.c > 0) {
      audit.responseStatus = 200;
      audit.durationMs = Date.now() - startTime;
      await logAudit(audit);
      return NextResponse.json({ ok: true, message: "Player profile already exists for this division" });
    }

    // Look up existing player data to copy fields
    const template = await query<{
      first: string; last: string; city: string; state: string; country: string;
      gender: string; section: string; district: string; grad_year: number;
      utr_singles: number; utr_doubles: string; wtn_singles: number; wtn_doubles: number;
    }>(
      "mta",
      `SELECT player_first AS first, player_last AS last,
         player_city AS city, player_state AS state, player_country AS country,
         player_gender AS gender, player_section AS section, player_district AS district,
         player_grad_year AS grad_year,
         utrSinglesDec AS utr_singles, utrDoubles AS utr_doubles,
         wtn_singles, wtn_doubles
       FROM \`1_Players\` WHERE usta_no = ? LIMIT 1`,
      [ustaNo]
    );

    if (template.length === 0) {
      audit.responseStatus = 404;
      audit.durationMs = Date.now() - startTime;
      await logAudit(audit);
      return NextResponse.json(
        { ok: false, error: "No existing player found for this USTA number", code: "NOT_FOUND", ref: requestId },
        { status: 404 }
      );
    }

    const t = template[0];

    // Create the new player profile row
    await query(
      "mta",
      `INSERT INTO \`1_Players\` (
         usta_no, player_age_group, player_first, player_last,
         player_city, player_state, player_country, player_gender,
         player_section, player_district, player_grad_year,
         utrSinglesDec, utrDoubles, wtn_singles, wtn_doubles
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ustaNo, ageGroup, t.first, t.last,
        t.city, t.state, t.country, t.gender,
        t.section, t.district, t.grad_year,
        t.utr_singles, t.utr_doubles, t.wtn_singles, t.wtn_doubles,
      ]
    );

    // If ownerId provided, also link via playerRelations
    if (ownerId) {
      // Get the new player_id
      const newPlayer = await query<{ pid: number }>(
        "mta",
        `SELECT player_id AS pid FROM \`1_Players\`
         WHERE usta_no = ? AND player_age_group = ? ORDER BY player_id DESC LIMIT 1`,
        [ustaNo, ageGroup]
      );

      if (newPlayer.length > 0) {
        const relExists = await query<{ c: number }>(
          "mta",
          `SELECT COUNT(*) AS c FROM playerRelations
           WHERE playerrel_usr_id = ? AND playerrel_player_id = ?`,
          [ownerId, newPlayer[0].pid]
        );

        if (relExists[0]?.c === 0) {
          await query(
            "mta",
            `INSERT INTO playerRelations (playerrel_usr_id, playerrel_player_id, playerrel_verify_id, playerrel_relation)
             VALUES (?, ?, ?, ?)`,
            [ownerId, newPlayer[0].pid, ustaNo, relation || "parent"]
          );
        }
      }
    }

    audit.responseStatus = 200;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);

    return NextResponse.json({ ok: true, message: "Player profile created and linked" });
  } catch (e) {
    console.error("[mta/create-player]", requestId, e);
    audit.responseStatus = 500;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);
    return NextResponse.json(
      { ok: false, error: "database error", code: "DATABASE_ERROR", ref: requestId },
      { status: 500 }
    );
  }
}
