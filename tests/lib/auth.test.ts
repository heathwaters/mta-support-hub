import { describe, it, expect } from "vitest";
import { validateRole } from "@/lib/auth";

describe("validateRole", () => {
  it("passes through a valid support_agent role", () => {
    expect(validateRole("support_agent")).toBe("support_agent");
  });

  it("passes through a valid support_admin role", () => {
    expect(validateRole("support_admin")).toBe("support_admin");
  });

  it("passes through a valid super_admin role", () => {
    expect(validateRole("super_admin")).toBe("super_admin");
  });

  it("falls back to support_agent for an unknown role string", () => {
    expect(validateRole("root")).toBe("support_agent");
  });

  it("falls back to support_agent for empty string", () => {
    expect(validateRole("")).toBe("support_agent");
  });

  it("falls back to support_agent for undefined", () => {
    expect(validateRole(undefined)).toBe("support_agent");
  });

  it("falls back to support_agent for null", () => {
    expect(validateRole(null)).toBe("support_agent");
  });

  it("falls back to support_agent for a number", () => {
    expect(validateRole(42)).toBe("support_agent");
  });

  it("falls back to support_agent for a boolean", () => {
    expect(validateRole(true)).toBe("support_agent");
  });

  it("falls back to support_agent for an object", () => {
    expect(validateRole({ role: "super_admin" })).toBe("support_agent");
  });

  it("falls back to support_agent for an array", () => {
    expect(validateRole(["super_admin"])).toBe("support_agent");
  });

  it("does not accept case variants (allow-list is exact)", () => {
    expect(validateRole("SUPPORT_ADMIN")).toBe("support_agent");
    expect(validateRole("Support_Admin")).toBe("support_agent");
  });

  it("does not accept whitespace-padded values (allow-list is exact)", () => {
    expect(validateRole(" support_admin ")).toBe("support_agent");
  });
});
