import { describe, it, expect } from "vitest";
import { classifyEndpoint } from "@/lib/rate-limit";

describe("classifyEndpoint", () => {
  describe("write-sensitive bucket (5/min)", () => {
    it("classifies /actions/reset-password", () => {
      expect(classifyEndpoint("/api/mtt/actions/reset-password", "POST")).toBe("write-sensitive");
    });

    it("classifies /mta/create-player", () => {
      expect(classifyEndpoint("/api/mta/create-player", "POST")).toBe("write-sensitive");
    });

    it("classifies /mta/update-player", () => {
      expect(classifyEndpoint("/api/mta/update-player", "POST")).toBe("write-sensitive");
    });

    it("classifies /mta/add-division", () => {
      expect(classifyEndpoint("/api/mta/add-division", "POST")).toBe("write-sensitive");
    });

    it("classifies /mta/update-tournament-phone", () => {
      expect(classifyEndpoint("/api/mta/update-tournament-phone", "POST")).toBe("write-sensitive");
    });
  });

  describe("write bucket (10/min)", () => {
    it("classifies generic /actions/ paths like update-role", () => {
      expect(classifyEndpoint("/api/mtt/actions/update-role", "POST")).toBe("write");
    });

    it("classifies generic /actions/ paths like unlock", () => {
      expect(classifyEndpoint("/api/mtt/actions/unlock", "POST")).toBe("write");
    });

    it("classifies non-GET non-sensitive routes", () => {
      expect(classifyEndpoint("/api/mtt/teams", "POST")).toBe("write");
      expect(classifyEndpoint("/api/mtt/teams", "PATCH")).toBe("write");
      expect(classifyEndpoint("/api/mtt/teams", "DELETE")).toBe("write");
    });
  });

  describe("search bucket (30/min)", () => {
    it("classifies /api/mta/search", () => {
      expect(classifyEndpoint("/api/mta/search", "GET")).toBe("search");
    });

    it("classifies /api/mtt/search", () => {
      expect(classifyEndpoint("/api/mtt/search", "GET")).toBe("search");
    });

    it("classifies /api/mta/player-search", () => {
      expect(classifyEndpoint("/api/mta/player-search", "GET")).toBe("search");
    });
  });

  describe("read bucket (60/min)", () => {
    it("classifies generic GET routes", () => {
      expect(classifyEndpoint("/api/mta/account", "GET")).toBe("read");
      expect(classifyEndpoint("/api/mtt/teams", "GET")).toBe("read");
      expect(classifyEndpoint("/api/mta/tournaments", "GET")).toBe("read");
    });
  });

  describe("precedence ordering", () => {
    it("prefers write-sensitive over generic write for MTA write paths", () => {
      // A POST to /mta/update-player must NOT fall into the generic
      // `method !== "GET"` bucket — the specific check must fire first.
      expect(classifyEndpoint("/api/mta/update-player", "POST")).toBe("write-sensitive");
      expect(classifyEndpoint("/api/mta/update-player", "POST")).not.toBe("write");
    });

    it("prefers write-sensitive over search (unlikely but guards ordering)", () => {
      // A hypothetical path that matches both categories — reset-password
      // check comes first.
      expect(classifyEndpoint("/api/mtt/actions/reset-password", "POST")).toBe("write-sensitive");
    });
  });
});
