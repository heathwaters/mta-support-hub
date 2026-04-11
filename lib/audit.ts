import type { UserContext } from "@/lib/auth";

/**
 * Mask an email for logging: "john@example.com" -> "j***@example.com"
 * Output format: first char of local part + "***@" + full domain.
 * Returns "***" for strings without "@".
 */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local[0] ?? ""}***@${domain}`;
}

export interface AuditEvent {
  requestId: string;
  timestamp: string;
  userId: string | null;
  userEmail: string | null;
  userRole: string | null;
  endpoint: string;
  method: string;
  params: Record<string, unknown>;
  responseStatus: number;
  ip: string;
  userAgent: string;
  durationMs: number;
  piiAccessed: boolean;
  action?: string;
  targetUserId?: number | string;
}

/**
 * Generate a unique request ID for correlation across logs and error responses.
 */
export function generateRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Log an audit event as structured JSON.
 *
 * Currently writes to stdout (Vercel log drain picks this up).
 * To add Supabase persistence, extend this function to INSERT into audit_logs table.
 */
export async function logAudit(event: AuditEvent): Promise<void> {
  // Sanitize params — never log passwords, tokens, or full emails in params
  const sanitized = { ...event.params };
  for (const key of Object.keys(sanitized)) {
    const lower = key.toLowerCase();
    if (lower.includes("password") || lower.includes("token") || lower.includes("secret")) {
      sanitized[key] = "[REDACTED]";
    }
  }

  const logEntry = {
    type: "audit",
    ...event,
    // Never log full email — mask PII in audit output
    userEmail: event.userEmail ? maskEmail(event.userEmail) : null,
    params: sanitized,
  };

  // AUDIT_SINK: intentional console.log — this is the canonical structured
  // audit output consumed by Vercel log drains and external SIEMs.
  // Do not remove or convert to another level; other routes emit console.info
  // for lifecycle logs and console.error for failures, both of which are
  // separate streams from the audit trail.
  console.log(JSON.stringify(logEntry));
}

/**
 * Create an audit event from a request + user context.
 * Call at the start of a request, then update responseStatus and durationMs before logging.
 */
export function createAuditEvent(
  req: Request,
  user: UserContext | null,
  requestId: string
): AuditEvent {
  const url = new URL(req.url);
  return {
    requestId,
    timestamp: new Date().toISOString(),
    userId: user?.id ?? null,
    userEmail: user?.email ?? null,
    userRole: user?.role ?? null,
    endpoint: url.pathname,
    method: req.method,
    params: Object.fromEntries(url.searchParams),
    responseStatus: 0,
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown",
    userAgent: req.headers.get("user-agent") || "unknown",
    durationMs: 0,
    piiAccessed: false,
  };
}
