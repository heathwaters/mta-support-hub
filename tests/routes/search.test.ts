import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => ({ id: "user-1", email: "a@b.co", role: "support_admin" })),
  hasRole: vi.fn(() => true),
  ROLES: { SUPPORT_AGENT: "support_agent", SUPPORT_ADMIN: "support_admin", SUPER_ADMIN: "super_admin" },
}));

vi.mock("@/lib/audit", () => ({
  createAuditEvent: vi.fn(() => ({
    requestId: "r", timestamp: "", userId: "", userEmail: "", userRole: "",
    endpoint: "", method: "", params: {}, responseStatus: 0, ip: "", userAgent: "",
    durationMs: 0, piiAccessed: false,
  })),
  logAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => null),
  classifyEndpoint: vi.fn(() => "read"),
}));

vi.mock("@/lib/db", () => ({
  query: mocks.query,
  cleanQ: (raw: string | null) => {
    if (!raw) return null;
    const q = raw.trim().replace(/[\x00-\x1F\x7F]/g, "").slice(0, 100);
    return q.length >= 2 ? q : null;
  },
  escapeLike: (q: string) => q.replace(/[%_\\]/g, "\\$&"),
}));

import { GET } from "@/app/api/mta/search/route";

function buildReq(query: string): Request {
  return new Request(`http://localhost/api/mta/search?q=${encodeURIComponent(query)}`, {
    method: "GET",
    headers: { "content-type": "application/json" },
  });
}

async function readJson(res: Response): Promise<{
  ok: boolean;
  error?: string;
  code?: string;
  data?: unknown[];
}> {
  return (await res.json()) as {
    ok: boolean;
    error?: string;
    code?: string;
    data?: unknown[];
  };
}

describe("GET /api/mta/search", () => {
  beforeEach(() => {
    mocks.query.mockReset();
  });

  it("rejects an empty query with 400", async () => {
    const res = await GET(
      new Request("http://localhost/api/mta/search", { method: "GET" })
    );
    expect(res.status).toBe(400);
    const body = await readJson(res);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.error).toMatch(/q required/);
  });

  it("rejects a 1-character query with 400", async () => {
    const res = await GET(buildReq("a"));
    expect(res.status).toBe(400);
  });

  it("returns empty data array when no accounts match", async () => {
    mocks.query.mockResolvedValueOnce([]);
    const res = await GET(buildReq("nobody"));
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.ok).toBe(true);
    expect(body.data).toEqual([]);
  });

  it("strips control characters from the query before executing", async () => {
    mocks.query.mockResolvedValueOnce([]);
    await GET(buildReq("hel\u0000lo"));
    const firstCallArgs = mocks.query.mock.calls[0];
    const paramsIndex = 2;
    const params = firstCallArgs[paramsIndex] as string[];
    expect(params.every((p) => !p.includes("\u0000"))).toBe(true);
  });

  it("escapes LIKE wildcards in the query", async () => {
    mocks.query.mockResolvedValueOnce([]);
    await GET(buildReq("50%_test"));
    const firstCallArgs = mocks.query.mock.calls[0];
    const params = firstCallArgs[2] as string[];
    // Raw `q` is passed for the exact email comparison; the escaped `%...%`
    // form is passed for LIKE slots. Assert at least one param has both
    // escape sequences, proving escapeLike was applied before LIKE use.
    const escaped = params.find((p) => p.includes("\\%") && p.includes("\\_"));
    expect(escaped).toBeDefined();
    expect(escaped).toMatch(/^%.*\\%.*\\_.*%$/);
  });
});
