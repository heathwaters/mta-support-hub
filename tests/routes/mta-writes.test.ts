import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  cmsPost: vi.fn(async () => undefined),
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireAuth: mocks.requireAuth,
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
  classifyEndpoint: vi.fn(() => "write"),
}));

vi.mock("@/lib/db", () => ({
  query: mocks.query,
}));

vi.mock("@/lib/cms", () => ({ cmsPost: mocks.cmsPost }));

import { POST as updatePlayer } from "@/app/api/mta/update-player/route";
import { POST as createPlayer } from "@/app/api/mta/create-player/route";
import { POST as addDivision } from "@/app/api/mta/add-division/route";
import { POST as updateTournamentPhone } from "@/app/api/mta/update-tournament-phone/route";
import { POST as syncWtn } from "@/app/api/mtt/actions/sync-wtn/route";

function buildReq(url: string, body: Record<string, unknown>): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function readJson(res: Response): Promise<{
  ok: boolean;
  error?: string;
  code?: string;
  ref?: string;
}> {
  return (await res.json()) as { ok: boolean; error?: string; code?: string; ref?: string };
}

const adminUser = { id: "user-1", email: "a@b.co", role: "support_admin" as const };
const forbiddenResponse = () =>
  NextResponse.json({ ok: false, error: "forbidden", code: "FORBIDDEN" }, { status: 403 });

beforeEach(() => {
  mocks.query.mockReset();
  mocks.cmsPost.mockReset();
  mocks.cmsPost.mockResolvedValue(undefined);
  mocks.requireAuth.mockReset();
  mocks.requireAuth.mockImplementation(async () => adminUser);
});

describe("POST /api/mta/update-player", () => {
  const url = "http://localhost/api/mta/update-player";

  it("returns 403 when requireAuth denies non-admin role", async () => {
    mocks.requireAuth.mockImplementationOnce(async () => forbiddenResponse());
    const res = await updatePlayer(buildReq(url, { ustaNo: "123456" }));
    expect(res.status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("returns 400 when ustaNo is missing", async () => {
    const res = await updatePlayer(buildReq(url, {}));
    expect(res.status).toBe(400);
    expect((await readJson(res)).code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when ustaNo is wrong type", async () => {
    const res = await updatePlayer(buildReq(url, { ustaNo: 12345 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when ustaNo is too short", async () => {
    const res = await updatePlayer(buildReq(url, { ustaNo: "1234" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when no valid update fields are provided", async () => {
    const res = await updatePlayer(buildReq(url, { ustaNo: "1234567" }));
    expect(res.status).toBe(400);
    expect((await readJson(res)).error).toMatch(/no valid fields/);
  });

  it("accepts a valid payload with utr and executes UPDATE", async () => {
    mocks.query.mockResolvedValueOnce([{ affected: 1 }]);
    const res = await updatePlayer(buildReq(url, { ustaNo: "1234567", utr: 12.5 }));
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.ok).toBe(true);
    expect(body.ref).toBeDefined();
    expect(mocks.query).toHaveBeenCalledTimes(1);
    const [, sql] = mocks.query.mock.calls[0];
    expect(sql).toMatch(/UPDATE `1_Players`/);
    expect(sql).toMatch(/utrSinglesDec = \?/);
  });

  it("rejects utr outside valid range", async () => {
    const res = await updatePlayer(buildReq(url, { ustaNo: "1234567", utr: 99 }));
    expect(res.status).toBe(400);
  });

  it("returns 500 DATABASE_ERROR and suppresses error detail when query throws", async () => {
    mocks.query.mockRejectedValueOnce(new Error("connection refused"));
    const res = await updatePlayer(buildReq(url, { ustaNo: "1234567", utr: 12 }));
    expect(res.status).toBe(500);
    const body = await readJson(res);
    expect(body.code).toBe("DATABASE_ERROR");
    expect(body.error).not.toContain("connection refused");
  });
});

describe("POST /api/mta/create-player", () => {
  const url = "http://localhost/api/mta/create-player";

  it("returns 403 when requireAuth denies non-admin role", async () => {
    mocks.requireAuth.mockImplementationOnce(async () => forbiddenResponse());
    const res = await createPlayer(buildReq(url, { ustaNo: "1234567", ageGroup: "18U" }));
    expect(res.status).toBe(403);
  });

  it("rejects missing ustaNo", async () => {
    const res = await createPlayer(buildReq(url, { ageGroup: "18U" }));
    expect(res.status).toBe(400);
  });

  it("rejects invalid ageGroup type", async () => {
    const res = await createPlayer(buildReq(url, { ustaNo: "1234567", ageGroup: 18 }));
    expect(res.status).toBe(400);
  });

  it("rejects ownerId of wrong type", async () => {
    const res = await createPlayer(buildReq(url, { ustaNo: "1234567", ageGroup: "18U", ownerId: "abc" }));
    expect(res.status).toBe(400);
  });

  it("returns early with exists message if division already present", async () => {
    mocks.query.mockResolvedValueOnce([{ c: 1 }]);
    const res = await createPlayer(buildReq(url, { ustaNo: "1234567", ageGroup: "18U" }));
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.ok).toBe(true);
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when no template player exists", async () => {
    mocks.query.mockResolvedValueOnce([{ c: 0 }]).mockResolvedValueOnce([]);
    const res = await createPlayer(buildReq(url, { ustaNo: "1234567", ageGroup: "18U" }));
    expect(res.status).toBe(404);
    expect((await readJson(res)).code).toBe("NOT_FOUND");
  });
});

describe("POST /api/mta/add-division", () => {
  const url = "http://localhost/api/mta/add-division";

  it("requires admin role", async () => {
    mocks.requireAuth.mockImplementationOnce(async () => forbiddenResponse());
    const res = await addDivision(buildReq(url, { ownerId: 1, ustaNo: "1234567", ageGroup: "18U" }));
    expect(res.status).toBe(403);
  });

  it("rejects missing ownerId", async () => {
    const res = await addDivision(buildReq(url, { ustaNo: "1234567", ageGroup: "18U" }));
    expect(res.status).toBe(400);
    expect((await readJson(res)).error).toMatch(/ownerId/);
  });

  it("rejects non-integer ownerId", async () => {
    const res = await addDivision(buildReq(url, { ownerId: 1.5, ustaNo: "1234567", ageGroup: "18U" }));
    expect(res.status).toBe(400);
  });

  it("rejects missing ageGroup", async () => {
    const res = await addDivision(buildReq(url, { ownerId: 1, ustaNo: "1234567" }));
    expect(res.status).toBe(400);
    expect((await readJson(res)).error).toMatch(/ageGroup/);
  });

  it("returns early when division already exists", async () => {
    mocks.query.mockResolvedValueOnce([{ c: 1 }]);
    const res = await addDivision(buildReq(url, { ownerId: 1, ustaNo: "1234567", ageGroup: "18U" }));
    expect(res.status).toBe(200);
    expect((await readJson(res)).ok).toBe(true);
  });
});

describe("POST /api/mta/update-tournament-phone", () => {
  const url = "http://localhost/api/mta/update-tournament-phone";

  it("requires admin role", async () => {
    mocks.requireAuth.mockImplementationOnce(async () => forbiddenResponse());
    const res = await updateTournamentPhone(buildReq(url, { tournId: 5, phone: "555-1234" }));
    expect(res.status).toBe(403);
  });

  it("rejects non-number tournId", async () => {
    const res = await updateTournamentPhone(buildReq(url, { tournId: "5", phone: "555-1234" }));
    expect(res.status).toBe(400);
  });

  it("rejects non-string phone", async () => {
    const res = await updateTournamentPhone(buildReq(url, { tournId: 5, phone: 5551234 }));
    expect(res.status).toBe(400);
  });

  it("strips disallowed characters from phone", async () => {
    mocks.query.mockResolvedValueOnce([]);
    const res = await updateTournamentPhone(buildReq(url, { tournId: 5, phone: "555-1234abc" }));
    expect(res.status).toBe(200);
    const [, , params] = mocks.query.mock.calls[0];
    expect((params as string[])[0]).toBe("555-1234");
  });

  it("returns 500 when query throws", async () => {
    mocks.query.mockRejectedValueOnce(new Error("boom"));
    const res = await updateTournamentPhone(buildReq(url, { tournId: 5, phone: "555-1234" }));
    expect(res.status).toBe(500);
    expect((await readJson(res)).code).toBe("DATABASE_ERROR");
  });
});

describe("POST /api/mtt/actions/sync-wtn", () => {
  const url = "http://localhost/api/mtt/actions/sync-wtn";

  it("requires admin role", async () => {
    mocks.requireAuth.mockImplementationOnce(async () => forbiddenResponse());
    const res = await syncWtn(buildReq(url, { usr_id: 1 }));
    expect(res.status).toBe(403);
  });

  it("rejects non-numeric usr_id", async () => {
    const res = await syncWtn(buildReq(url, { usr_id: "1" }));
    expect(res.status).toBe(400);
    expect((await readJson(res)).code).toBe("VALIDATION_ERROR");
  });

  it("rejects zero usr_id", async () => {
    const res = await syncWtn(buildReq(url, { usr_id: 0 }));
    expect(res.status).toBe(400);
  });

  it("calls cmsPost on valid payload and returns rating", async () => {
    mocks.cmsPost.mockResolvedValueOnce({ rating: "14.5" });
    const res = await syncWtn(buildReq(url, { usr_id: 1 }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; rating: string; ref: string };
    expect(body.rating).toBe("14.5");
    expect(mocks.cmsPost).toHaveBeenCalledWith("mtt", "AdminMain", "updateTlinkTeamStatus", { usr_id: 1 });
  });

  it("returns 502 CMS_ERROR when cmsPost throws", async () => {
    mocks.cmsPost.mockRejectedValueOnce(new Error("upstream down"));
    const res = await syncWtn(buildReq(url, { usr_id: 1 }));
    expect(res.status).toBe(502);
    const body = await readJson(res);
    expect(body.code).toBe("CMS_ERROR");
    expect(body.error).not.toContain("upstream down");
  });
});
