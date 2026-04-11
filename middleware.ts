import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Note: middleware runs in the Edge/Node runtime — keep imports lightweight.
// We do NOT import lib/auth.ts here because middleware.ts has its own execution context.
// Instead we inline the minimal verification logic needed.

const PUBLIC_PATHS = ["/api/health", "/api/config"];

export const config = {
  matcher: "/api/:path*",
};

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  // Public paths — no auth required
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return addSecurityHeaders(NextResponse.next());
  }

  // --- Authentication ---
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return addSecurityHeaders(
      NextResponse.json(
        { ok: false, error: "unauthorized", code: "UNAUTHORIZED" },
        { status: 401 }
      )
    );
  }

  const token = authHeader.slice(7);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error("[middleware] Missing Supabase env vars");
    return addSecurityHeaders(
      NextResponse.json(
        { ok: false, error: "internal error", code: "INTERNAL_ERROR" },
        { status: 500 }
      )
    );
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return addSecurityHeaders(
      NextResponse.json(
        { ok: false, error: "unauthorized", code: "UNAUTHORIZED" },
        { status: 401 }
      )
    );
  }

  // Extract role from app_metadata (server-side only — users cannot self-modify)
  const role = user.app_metadata?.role || "support_agent";

  // --- RBAC: Write actions require support_admin or higher ---
  if (pathname.includes("/actions/")) {
    const writeRoles = ["support_admin", "super_admin"];
    if (!writeRoles.includes(role)) {
      return addSecurityHeaders(
        NextResponse.json(
          { ok: false, error: "forbidden", code: "FORBIDDEN" },
          { status: 403 }
        )
      );
    }
  }

  // --- CSRF check for mutation requests ---
  if (req.method === "POST" || req.method === "PATCH" || req.method === "DELETE") {
    const xrw = req.headers.get("x-requested-with");
    if (xrw !== "XMLHttpRequest") {
      return addSecurityHeaders(
        NextResponse.json(
          { ok: false, error: "missing x-requested-with header", code: "FORBIDDEN" },
          { status: 403 }
        )
      );
    }
  }

  // --- Pass user context to route handlers via request headers ---
  // Only pass user ID and role — never pass email in headers (visible to client/proxies)
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-user-id", user.id);
  requestHeaders.set("x-user-role", role);
  requestHeaders.set("x-request-id", crypto.randomUUID());

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  return addSecurityHeaders(response);
}

/**
 * Add security headers to every API response.
 */
function addSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.headers.set("X-DNS-Prefetch-Control", "off");
  // HSTS is set by Vercel at the platform level, but we add it for non-Vercel deployments
  response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  return response;
}
