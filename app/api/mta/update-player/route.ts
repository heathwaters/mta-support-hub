import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAuth, ROLES, type UserContext } from "@/lib/auth";
import { createAuditEvent, logAudit } from "@/lib/audit";
import { checkRateLimit, classifyEndpoint } from "@/lib/rate-limit";
import { safeRequestId, parseJsonBody } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TEXT_MAX = 64;
const STATE_MAX = 4;

function asTrimmedString(v: unknown, max: number): string | null {
  if (v == null) return null;
  if (typeof v !== "string") return null;
  return v.trim().slice(0, max);
}

function asNumberOrNull(v: unknown, min: number, max: number): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return undefined;
  if (n < min || n > max) return undefined;
  return n;
}

function asIntOrNull(v: unknown, min: number, max: number): number | null | undefined {
  const n = asNumberOrNull(v, min, max);
  if (n === undefined || n === null) return n;
  return Math.trunc(n);
}

export async function POST(req: Request) {
  const requestId = safeRequestId(req.headers.get("x-request-id"));
  const startTime = Date.now();

  const authResult = await requireAuth(req, ROLES.SUPPORT_ADMIN);
  if (authResult instanceof NextResponse) return authResult;
  const user: UserContext = authResult;

  const rlCategory = classifyEndpoint(new URL(req.url).pathname, req.method);
  const rlResult = await checkRateLimit(user.id, rlCategory);
  if (rlResult) return rlResult;

  const audit = createAuditEvent(req, user, requestId);
  audit.action = "mta-update-player";
  audit.piiAccessed = true;

  const parsed = await parseJsonBody(req);
  if (!parsed.data) {
    audit.responseStatus = 400;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);
    return NextResponse.json(
      { ok: false, error: parsed.error, code: "INVALID_JSON", ref: requestId },
      { status: ("status" in parsed && parsed.status) || 400 }
    );
  }

  const body = parsed.data;
  const ustaNo = body.ustaNo;

  if (typeof ustaNo !== "string" || !/^\d{5,}$/.test(ustaNo)) {
    audit.responseStatus = 400;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);
    return NextResponse.json(
      { ok: false, error: "valid ustaNo required", code: "VALIDATION_ERROR", ref: requestId },
      { status: 400 }
    );
  }

  const utr = asNumberOrNull(body.utr, 0, 17);
  const wtn = asNumberOrNull(body.wtn, 0, 99);
  const gradYear = asIntOrNull(body.gradYear, 1900, 2100);
  const section = asTrimmedString(body.section, TEXT_MAX);
  const district = asTrimmedString(body.district, TEXT_MAX);
  const city = asTrimmedString(body.city, TEXT_MAX);
  const state = asTrimmedString(body.state, STATE_MAX);

  const sets: string[] = [];
  const params: (string | number | null)[] = [];

  if (utr !== undefined) { sets.push("utrSinglesDec = ?"); params.push(utr); }
  if (wtn !== undefined) { sets.push("wtn_singles = ?"); params.push(wtn); }
  if (gradYear !== undefined) { sets.push("player_grad_year = ?"); params.push(gradYear); }
  if (section !== null) { sets.push("player_section = ?"); params.push(section); }
  if (district !== null) { sets.push("player_district = ?"); params.push(district); }
  if (city !== null) { sets.push("player_city = ?"); params.push(city); }
  if (state !== null) { sets.push("player_state = ?"); params.push(state); }

  if (sets.length === 0) {
    audit.responseStatus = 400;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);
    return NextResponse.json(
      { ok: false, error: "no valid fields to update", code: "VALIDATION_ERROR", ref: requestId },
      { status: 400 }
    );
  }

  params.push(ustaNo);

  try {
    const result = await query<{ affected: number }>(
      "mta",
      `UPDATE \`1_Players\` SET ${sets.join(", ")} WHERE usta_no = ?`,
      params
    );

    audit.responseStatus = 200;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);

    return NextResponse.json({
      ok: true,
      ref: requestId,
      updated: {
        ...(utr !== undefined && { utrSingles: utr == null ? "" : String(utr) }),
        ...(wtn !== undefined && { wtnSingles: wtn == null ? "" : String(wtn) }),
        ...(gradYear !== undefined && { gradYear: gradYear == null ? "" : gradYear }),
        ...(section !== null && { section }),
        ...(district !== null && { district }),
        ...(city !== null && { city }),
        ...(state !== null && { state }),
      },
      rows: Array.isArray(result) ? result.length : 0,
    });
  } catch (e) {
    console.error(JSON.stringify({ type: "error", ref: requestId, endpoint: "mta/update-player", msg: e instanceof Error ? e.message : String(e) }));
    audit.responseStatus = 500;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);
    return NextResponse.json(
      { ok: false, error: "database error", code: "DATABASE_ERROR", ref: requestId },
      { status: 500 }
    );
  }
}
