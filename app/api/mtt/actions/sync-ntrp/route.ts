import { NextResponse } from "next/server";
import { cmsPost } from "@/lib/cms";
import { requireAuth, ROLES, type UserContext } from "@/lib/auth";
import { createAuditEvent, logAudit } from "@/lib/audit";
import { checkRateLimit, classifyEndpoint } from "@/lib/rate-limit";
import { safeRequestId, isValidUsrId, parseJsonBody } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const requestId = safeRequestId(req.headers.get("x-request-id"));
  const startTime = Date.now();

  const authResult = await requireAuth(req, ROLES.SUPPORT_ADMIN);
  if (authResult instanceof NextResponse) return authResult;
  const user: UserContext = authResult;

  // --- Rate limit: write (10/min) ---
  const rlCategory = classifyEndpoint(new URL(req.url).pathname, req.method);
  const rlResult = await checkRateLimit(user.id, rlCategory);
  if (rlResult) return rlResult;

  const audit = createAuditEvent(req, user, requestId);
  audit.action = "sync-ntrp";

  const parsed = await parseJsonBody(req);
  if (!parsed.data) {
    audit.responseStatus = 400;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);
    return NextResponse.json({ ok: false, error: parsed.error, code: "INVALID_JSON", ref: requestId }, { status: ("status" in parsed && parsed.status) || 400 });
  }

  const { usr_id } = parsed.data;

  if (!isValidUsrId(usr_id)) {
    audit.responseStatus = 400;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);
    return NextResponse.json({ ok: false, error: "usr_id must be a positive integer", code: "VALIDATION_ERROR", ref: requestId }, { status: 400 });
  }

  audit.targetUserId = usr_id;

  try {
    const data = await cmsPost<{ rating?: string; ntrp?: string; data?: string }>(
      "mtt",
      "USTA",
      "checkNTRPrating",
      { usr_id }
    );

    // CMS response shape varies — probe known fields
    const rating = typeof data?.rating === "string" ? data.rating
      : typeof data?.ntrp === "string" ? data.ntrp
      : null;

    audit.responseStatus = 200;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);

    return NextResponse.json({ ok: true, rating });
  } catch (e) {
    console.error(JSON.stringify({ type: "error", ref: requestId, endpoint: "mtt/actions/sync-ntrp", msg: e instanceof Error ? e.message : String(e) }));
    audit.responseStatus = 502;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);
    return NextResponse.json({ ok: false, error: "Failed to sync NTRP.", code: "CMS_ERROR", ref: requestId }, { status: 502 });
  }
}
