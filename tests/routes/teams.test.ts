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
}));

import { GET } from "@/app/api/mtt/teams/route";

function buildReq(usrIdRaw: string | null): Request {
  const url = usrIdRaw == null
    ? "http://localhost/api/mtt/teams"
    : `http://localhost/api/mtt/teams?usr_id=${encodeURIComponent(usrIdRaw)}`;
  return new Request(url, { method: "GET" });
}

async function readJson(res: Response): Promise<{
  ok: boolean;
  error?: string;
  code?: string;
  ref?: string;
  teams?: unknown[];
  tournTeams?: unknown[];
}> {
  return (await res.json()) as {
    ok: boolean;
    error?: string;
    code?: string;
    ref?: string;
    teams?: unknown[];
    tournTeams?: unknown[];
  };
}

function makeRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    team_name: "Team A",
    team_id: 1,
    team_status: "active",
    member_user_type: "captain",
    member_title: "",
    tourn_id: null,
    tourn_title: null,
    tourn_state: null,
    tourn_start_date: null,
    tourn_end_date: null,
    tourn_reg_link: null,
    tourn_director: null,
    tourn_email: null,
    tourn_website: null,
    tournpart_id: null,
    tournpart_amt_paid: null,
    tournpart_price: null,
    ...overrides,
  };
}

describe("GET /api/mtt/teams — validation", () => {
  beforeEach(() => {
    mocks.query.mockReset();
  });

  it("rejects missing usr_id with 400 VALIDATION_ERROR", async () => {
    const res = await GET(buildReq(null));
    expect(res.status).toBe(400);
    const body = await readJson(res);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.ref).toBeDefined();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("rejects non-numeric usr_id with 400", async () => {
    const res = await GET(buildReq("not-a-number"));
    expect(res.status).toBe(400);
    const body = await readJson(res);
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("rejects zero usr_id with 400", async () => {
    const res = await GET(buildReq("0"));
    expect(res.status).toBe(400);
  });

  it("rejects negative usr_id with 400", async () => {
    const res = await GET(buildReq("-5"));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/mtt/teams — response shape", () => {
  beforeEach(() => {
    mocks.query.mockReset();
  });

  it("returns empty teams and tournTeams when query returns no rows", async () => {
    mocks.query.mockResolvedValueOnce([]);
    const res = await GET(buildReq("123"));
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.ok).toBe(true);
    expect(body.teams).toEqual([]);
    expect(body.tournTeams).toEqual([]);
    expect(body.ref).toBeDefined();
  });

  it("splits rows with tourn_id into tournTeams and without into teams", async () => {
    mocks.query.mockResolvedValueOnce([
      makeRow({ team_id: 1, team_name: "Plain A" }),
      makeRow({
        team_id: 2,
        team_name: "Tourn B",
        tourn_id: 42,
        tourn_title: "Nationals",
        tourn_state: "CA",
      }),
    ]);
    const res = await GET(buildReq("123"));
    const body = await readJson(res);
    expect(body.teams).toHaveLength(1);
    expect((body.teams![0] as { team_id: number }).team_id).toBe(1);
    expect(body.tournTeams).toHaveLength(1);
    expect((body.tournTeams![0] as { team_id: number }).team_id).toBe(2);
  });

  it("deduplicates plain teams that appear multiple times from joins", async () => {
    mocks.query.mockResolvedValueOnce([
      makeRow({ team_id: 1, team_name: "Duplicate Team" }),
      makeRow({ team_id: 1, team_name: "Duplicate Team" }),
      makeRow({ team_id: 1, team_name: "Duplicate Team" }),
    ]);
    const res = await GET(buildReq("123"));
    const body = await readJson(res);
    expect(body.teams).toHaveLength(1);
  });

  it("excludes a team from plain-teams list if the same team has a tournament row", async () => {
    mocks.query.mockResolvedValueOnce([
      makeRow({ team_id: 5, team_name: "Team With Tourn", tourn_id: 99, tourn_title: "Regional" }),
      makeRow({ team_id: 5, team_name: "Team With Tourn" }),
    ]);
    const res = await GET(buildReq("123"));
    const body = await readJson(res);
    expect(body.teams).toHaveLength(0);
    expect(body.tournTeams).toHaveLength(1);
  });

  it("maps is_captain and is_co_captain from member_user_type", async () => {
    mocks.query.mockResolvedValueOnce([
      makeRow({ team_id: 1, member_user_type: "captain" }),
      makeRow({ team_id: 2, member_user_type: "co-captain" }),
      makeRow({ team_id: 3, member_user_type: "cocaptain" }),
      makeRow({ team_id: 4, member_user_type: "athlete" }),
    ]);
    const res = await GET(buildReq("123"));
    const body = await readJson(res);
    const teams = body.teams as Array<{ team_id: number; is_captain: boolean; is_co_captain: boolean }>;
    expect(teams.find((t) => t.team_id === 1)?.is_captain).toBe(true);
    expect(teams.find((t) => t.team_id === 2)?.is_co_captain).toBe(true);
    expect(teams.find((t) => t.team_id === 3)?.is_co_captain).toBe(true);
    expect(teams.find((t) => t.team_id === 4)?.is_captain).toBe(false);
    expect(teams.find((t) => t.team_id === 4)?.is_co_captain).toBe(false);
  });

  it("returns 500 DATABASE_ERROR with ref when the query throws", async () => {
    mocks.query.mockRejectedValueOnce(new Error("connection lost"));
    const res = await GET(buildReq("123"));
    expect(res.status).toBe(500);
    const body = await readJson(res);
    expect(body.ok).toBe(false);
    expect(body.code).toBe("DATABASE_ERROR");
    expect(body.ref).toBeDefined();
    expect(body.error).not.toContain("connection lost"); // never leak internals
  });
});
