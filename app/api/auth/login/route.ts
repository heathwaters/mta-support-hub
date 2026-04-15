import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getAdminClient } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { logAudit, generateRequestId, maskEmail, type AuditEvent } from "@/lib/audit";

export const runtime = "nodejs";

// Hybrid email-or-username login. Public endpoint (added to PUBLIC_PATHS in
// middleware.ts so it bypasses the bearer-token check). All failure modes —
// missing username, bad password, malformed body — return the SAME response
// shape and HTTP status to prevent username enumeration. Timing differences
// between paths are bounded by the 5-req/min unauthenticated rate limit.

const BodySchema = z.object({
  identifier: z.string().min(1).max(320),
  password: z.string().min(1).max(256),
});

const GENERIC_ERROR_BODY = {
  ok: false as const,
  error: "Invalid credentials",
  code: "INVALID_CREDENTIALS" as const,
};
const GENERIC_ERROR_STATUS = 400;

function genericError() {
  return NextResponse.json(GENERIC_ERROR_BODY, { status: GENERIC_ERROR_STATUS });
}

function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function buildAuditEvent(
  req: Request,
  requestId: string,
  maskedIdentifier: string
): AuditEvent {
  const url = new URL(req.url);
  return {
    requestId,
    timestamp: new Date().toISOString(),
    userId: null,
    userEmail: null,
    userRole: null,
    endpoint: url.pathname,
    method: req.method,
    params: { identifier: maskedIdentifier },
    responseStatus: 0,
    ip: clientIp(req),
    userAgent: req.headers.get("user-agent") || "unknown",
    durationMs: 0,
    piiAccessed: false,
  };
}

function maskIdentifier(identifier: string): string {
  if (identifier.includes("@")) return maskEmail(identifier);
  // Username: keep first 2 chars, mask the rest. Avoids leaking full username
  // into logs while still being enough for an admin to recognize who it is.
  return identifier.slice(0, 2) + "***";
}

export async function POST(req: Request) {
  const requestId = generateRequestId();
  const startedAt = Date.now();
  const ip = clientIp(req);

  // Rate limit per IP using the shared 5/min unauthenticated bucket.
  const rl = await checkRateLimit(`auth-login:${ip}`, "unauthenticated");
  if (rl) return rl;

  // Parse + validate body.
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return genericError();
  }
  const parsed = BodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return genericError();
  }
  const { identifier, password } = parsed.data;

  const masked = maskIdentifier(identifier);
  const audit = buildAuditEvent(req, requestId, masked);

  // Resolve identifier → email. If the identifier contains "@", treat it as
  // an email and skip the username lookup. Otherwise look up the user id by
  // username in profiles, then fetch the email via the admin API.
  let resolvedEmail: string | null = null;
  if (identifier.includes("@")) {
    resolvedEmail = identifier;
  } else {
    try {
      const admin = getAdminClient();
      const { data: profileRaw, error: profileErr } = await admin
        .from("profiles")
        .select("id")
        .eq("username", identifier.toLowerCase())
        .maybeSingle();

      // getAdminClient() returns an untyped SupabaseClient (no Database
      // generic), so .from() data is inferred as `never`. Narrow it here.
      const profile = profileRaw as { id: string } | null;

      if (!profileErr && profile) {
        const { data: userResp, error: userErr } =
          await admin.auth.admin.getUserById(profile.id);
        if (!userErr && userResp?.user?.email) {
          resolvedEmail = userResp.user.email;
        }
      }
    } catch (e) {
      // Log but don't reveal — fall through to the generic-error path below.
      console.error(
        JSON.stringify({
          type: "error",
          endpoint: "auth/login",
          requestId,
          msg: e instanceof Error ? e.message : String(e),
        })
      );
    }
  }

  // If we couldn't resolve an email, return the generic error. We deliberately
  // do NOT short-circuit before this point — the caller can't distinguish
  // "no such username" from "wrong password" because both yield the same
  // response. (Rate limiting bounds timing-based enumeration.)
  if (!resolvedEmail) {
    audit.responseStatus = GENERIC_ERROR_STATUS;
    audit.durationMs = Date.now() - startedAt;
    await logAudit(audit);
    return genericError();
  }

  // Sign in using a fresh anon client. Server-side, so no session persistence.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error(
      JSON.stringify({
        type: "error",
        endpoint: "auth/login",
        requestId,
        msg: "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY",
      })
    );
    return NextResponse.json(
      { ok: false, error: "internal error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
  const anon = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await anon.auth.signInWithPassword({
    email: resolvedEmail,
    password,
  });

  if (error || !data?.session || !data.user) {
    audit.responseStatus = GENERIC_ERROR_STATUS;
    audit.durationMs = Date.now() - startedAt;
    await logAudit(audit);
    return genericError();
  }

  // Success. Log with the now-known user id (still mask the identifier).
  audit.userId = data.user.id;
  audit.userEmail = data.user.email ?? null;
  audit.userRole = (data.user.app_metadata?.role as string | undefined) ?? null;
  audit.responseStatus = 200;
  audit.durationMs = Date.now() - startedAt;
  await logAudit(audit);

  return NextResponse.json({
    ok: true,
    session: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at,
      expires_in: data.session.expires_in,
      token_type: data.session.token_type,
    },
  });
}
