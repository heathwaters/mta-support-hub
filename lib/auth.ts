import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

// --- Roles ---

export const ROLES = {
  SUPPORT_AGENT: "support_agent",
  SUPPORT_ADMIN: "support_admin",
  SUPER_ADMIN: "super_admin",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

// Role hierarchy: super_admin > support_admin > support_agent
const ROLE_HIERARCHY: Record<Role, number> = {
  [ROLES.SUPPORT_AGENT]: 1,
  [ROLES.SUPPORT_ADMIN]: 2,
  [ROLES.SUPER_ADMIN]: 3,
};

export interface UserContext {
  id: string;
  email: string;
  role: Role;
}

// --- Supabase admin client (server-side only) ---

let _adminClient: ReturnType<typeof createClient> | null = null;

function getAdminClient() {
  if (_adminClient) return _adminClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  _adminClient = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _adminClient;
}

// --- Session verification ---

/**
 * Verify the Authorization: Bearer <token> header and return the user context.
 * Uses supabase.auth.getUser() which checks against Supabase's session store,
 * catching revoked sessions in real-time (not just JWT signature).
 */
export async function verifySession(req: Request): Promise<UserContext | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);
  if (!token) return null;

  try {
    const supabase = getAdminClient();
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) return null;

    // Extract role from app_metadata (server-side only — users cannot self-modify)
    const role = (user.app_metadata?.role as Role) || ROLES.SUPPORT_AGENT;

    // Validate role is a known value
    if (!Object.values(ROLES).includes(role)) {
      return { id: user.id, email: user.email ?? "", role: ROLES.SUPPORT_AGENT };
    }

    return { id: user.id, email: user.email ?? "", role };
  } catch (e) {
    console.error(JSON.stringify({ type: "error", endpoint: "auth/verifySession", msg: e instanceof Error ? e.message : String(e) }));
    return null;
  }
}

// --- Role checking ---

export function hasRole(user: UserContext, requiredRole: Role): boolean {
  return ROLE_HIERARCHY[user.role] >= ROLE_HIERARCHY[requiredRole];
}

// --- Response helpers ---

export function unauthorized() {
  return NextResponse.json(
    { ok: false, error: "unauthorized", code: "UNAUTHORIZED" },
    { status: 401 }
  );
}

export function forbidden() {
  return NextResponse.json(
    { ok: false, error: "forbidden", code: "FORBIDDEN" },
    { status: 403 }
  );
}

/**
 * Require authentication and optionally a minimum role.
 * Returns the UserContext on success, or a NextResponse error on failure.
 */
export async function requireAuth(
  req: Request,
  minimumRole: Role = ROLES.SUPPORT_AGENT
): Promise<UserContext | NextResponse> {
  const user = await verifySession(req);
  if (!user) return unauthorized();
  if (!hasRole(user, minimumRole)) return forbidden();
  return user;
}
