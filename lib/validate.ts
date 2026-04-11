/**
 * Shared validation helpers for API route handlers.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validate or generate a request ID. Rejects non-UUID values to prevent audit log injection. */
export function safeRequestId(header: string | null): string {
  if (header && UUID_RE.test(header)) return header;
  return crypto.randomUUID();
}

/** Validate usr_id: must be a positive integer within MySQL INT range. */
export function isValidUsrId(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 2147483647;
}

/** T-shirt size allowlist — shared across routes that validate shirt sizes. */
export const VALID_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "XXXL"] as const;

/**
 * Safely parse JSON body with Content-Type and shape validation.
 * Returns 415 for non-JSON content types, rejects array bodies.
 */
export async function parseJsonBody(
  req: Request
): Promise<{ data: Record<string, unknown> } | { data: null; error: string; status?: number }> {
  // Enforce application/json content type
  if (!req.headers.get("content-type")?.includes("application/json")) {
    return { data: null, error: "Unsupported Media Type", status: 415 };
  }

  try {
    const body = await req.json();

    // Reject non-object bodies (arrays, primitives)
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return { data: null, error: "Body must be a JSON object" };
    }

    return { data: body as Record<string, unknown> };
  } catch {
    return { data: null, error: "Invalid JSON body" };
  }
}
