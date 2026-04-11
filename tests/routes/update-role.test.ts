import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  cmsPost: vi.fn(async () => undefined),
}));

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => ({ id: "user-1", email: "a@b.co", role: "support_admin" })),
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

vi.mock("@/lib/cms", () => ({ cmsPost: mocks.cmsPost }));

import { POST } from "@/app/api/mtt/actions/update-role/route";

function buildReq(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/mtt/actions/update-role", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function readJson(res: Response): Promise<{ ok: boolean; error?: string; code?: string }> {
  return (await res.json()) as { ok: boolean; error?: string; code?: string };
}

describe("POST /api/mtt/actions/update-role — validation", () => {
  beforeEach(() => {
    mocks.cmsPost.mockClear();
  });

  it("rejects when usr_id is missing", async () => {
    const res = await POST(buildReq({ team_id: 5, role: "captain" }));
    expect(res.status).toBe(400);
    const body = await readJson(res);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.error).toMatch(/usr_id/);
    expect(mocks.cmsPost).not.toHaveBeenCalled();
  });

  it("rejects when team_id is a string (e.g. '5')", async () => {
    const res = await POST(buildReq({ usr_id: 1, team_id: "5", role: "captain" }));
    expect(res.status).toBe(400);
    const body = await readJson(res);
    expect(body.error).toMatch(/team_id/);
    expect(mocks.cmsPost).not.toHaveBeenCalled();
  });

  it("rejects when team_id is null", async () => {
    const res = await POST(buildReq({ usr_id: 1, team_id: null, role: "captain" }));
    expect(res.status).toBe(400);
    expect((await readJson(res)).error).toMatch(/team_id/);
  });

  it("rejects when team_id is a float", async () => {
    const res = await POST(buildReq({ usr_id: 1, team_id: 5.5, role: "captain" }));
    expect(res.status).toBe(400);
    expect((await readJson(res)).error).toMatch(/team_id/);
  });

  it("rejects when team_id is zero", async () => {
    const res = await POST(buildReq({ usr_id: 1, team_id: 0, role: "captain" }));
    expect(res.status).toBe(400);
    expect((await readJson(res)).error).toMatch(/team_id/);
  });

  it("rejects when team_id is negative", async () => {
    const res = await POST(buildReq({ usr_id: 1, team_id: -3, role: "captain" }));
    expect(res.status).toBe(400);
    expect((await readJson(res)).error).toMatch(/team_id/);
  });

  it("rejects when team_id is NaN", async () => {
    const res = await POST(buildReq({ usr_id: 1, team_id: Number.NaN, role: "captain" }));
    expect(res.status).toBe(400);
    expect((await readJson(res)).error).toMatch(/team_id/);
  });

  it("rejects when role is a non-string (number)", async () => {
    const res = await POST(buildReq({ usr_id: 1, team_id: 5, role: 123 }));
    expect(res.status).toBe(400);
    const body = await readJson(res);
    expect(body.error).toMatch(/role must be a string/);
  });

  it("rejects when role is a non-string (null)", async () => {
    const res = await POST(buildReq({ usr_id: 1, team_id: 5, role: null }));
    expect(res.status).toBe(400);
    expect((await readJson(res)).error).toMatch(/role must be a string/);
  });

  it("rejects when role string is not in the allow-list", async () => {
    const res = await POST(buildReq({ usr_id: 1, team_id: 5, role: "admin" }));
    expect(res.status).toBe(400);
    const body = await readJson(res);
    expect(body.error).toMatch(/one of/);
  });

  it("accepts a valid payload and calls cmsPost", async () => {
    const res = await POST(buildReq({ usr_id: 1, team_id: 5, role: "captain" }));
    expect(res.status).toBe(200);
    expect(mocks.cmsPost).toHaveBeenCalledWith("mtt", "AdminTask", "updateTeamMemberRole", {
      usr_id: 1,
      team_id: 5,
      member_user_type: "captain",
    });
  });
});
