import { NextResponse } from "next/server";
import { cmsPost } from "@/lib/cms";
import { requireAuth, ROLES, type UserContext } from "@/lib/auth";
import { createAuditEvent, logAudit } from "@/lib/audit";
import { checkRateLimit, classifyEndpoint } from "@/lib/rate-limit";
import { safeRequestId, isValidUsrId, parseJsonBody } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_ROLES = ["captain", "co-captain", "athlete"] as const;

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
  audit.action = "update-role";

  const parsed = await parseJsonBody(req);
  if (!parsed.data) {
    audit.responseStatus = 400;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);
    return NextResponse.json({ ok: false, error: parsed.error, code: "INVALID_JSON", ref: requestId }, { status: ("status" in parsed && parsed.status) || 400 });
  }

  const { usr_id, team_id, role } = parsed.data;

  if (!isValidUsrId(usr_id)) {
    audit.responseStatus = 400;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);
    return NextResponse.json({ ok: false, error: "usr_id must be a positive integer", code: "VALIDATION_ERROR", ref: requestId }, { status: 400 });
  }

  if (!team_id || !Number.isInteger(team_id) || team_id <= 0) {
    audit.responseStatus = 400;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);
    return NextResponse.json({ ok: false, error: "team_id must be a positive integer", code: "VALIDATION_ERROR", ref: requestId }, { status: 400 });
  }

  if (!VALID_ROLES.includes(role as typeof VALID_ROLES[number])) {
    audit.responseStatus = 400;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);
    return NextResponse.json({ ok: false, error: `role must be one of: ${VALID_ROLES.join(", ")}`, code: "VALIDATION_ERROR", ref: requestId }, { status: 400 });
  }

  audit.targetUserId = usr_id;

  try {
    await cmsPost("mtt", "AdminTask", "updateTeamMemberRole", {
      usr_id,
      team_id,
      member_user_type: role,
    });

    audit.responseStatus = 200;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(JSON.stringify({ type: "error", ref: requestId, endpoint: "mtt/actions/update-role", msg: e instanceof Error ? e.message : String(e) }));
    audit.responseStatus = 502;
    audit.durationMs = Date.now() - startTime;
    await logAudit(audit);
    return NextResponse.json({ ok: false, error: "Failed to update role.", code: "CMS_ERROR", ref: requestId }, { status: 502 });
  }
}
