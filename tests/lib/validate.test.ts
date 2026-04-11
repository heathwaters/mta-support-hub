import { describe, it, expect } from "vitest";
import { isValidUsrId, parseJsonBody, safeRequestId } from "@/lib/validate";

describe("isValidUsrId", () => {
  it("accepts positive integers within INT range", () => {
    expect(isValidUsrId(1)).toBe(true);
    expect(isValidUsrId(2147483647)).toBe(true);
  });

  it("rejects zero and negatives", () => {
    expect(isValidUsrId(0)).toBe(false);
    expect(isValidUsrId(-1)).toBe(false);
  });

  it("rejects non-integer numbers", () => {
    expect(isValidUsrId(1.5)).toBe(false);
    expect(isValidUsrId(NaN)).toBe(false);
  });

  it("rejects non-number types", () => {
    expect(isValidUsrId("1")).toBe(false);
    expect(isValidUsrId(null)).toBe(false);
    expect(isValidUsrId(undefined)).toBe(false);
    expect(isValidUsrId(true)).toBe(false);
  });

  it("rejects values above INT max", () => {
    expect(isValidUsrId(2147483648)).toBe(false);
  });
});

describe("parseJsonBody", () => {
  function jsonReq(body: unknown, contentType = "application/json"): Request {
    return new Request("http://localhost/test", {
      method: "POST",
      headers: { "content-type": contentType },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  it("parses a JSON object body", async () => {
    const req = jsonReq({ a: 1, b: "x" });
    const result = await parseJsonBody(req);
    expect(result.data).toEqual({ a: 1, b: "x" });
  });

  it("rejects non-JSON content type", async () => {
    const req = new Request("http://localhost/test", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    });
    const result = await parseJsonBody(req);
    expect(result.data).toBeNull();
    if (result.data === null) {
      expect(result.status).toBe(415);
    }
  });

  it("rejects array bodies", async () => {
    const req = jsonReq([1, 2, 3]);
    const result = await parseJsonBody(req);
    expect(result.data).toBeNull();
  });

  it("rejects primitive bodies", async () => {
    const req = jsonReq("42", "application/json");
    const result = await parseJsonBody(req);
    expect(result.data).toBeNull();
  });

  it("rejects malformed JSON", async () => {
    const req = jsonReq("{not json", "application/json");
    const result = await parseJsonBody(req);
    expect(result.data).toBeNull();
  });
});

describe("safeRequestId", () => {
  it("returns the header when it is a valid UUID", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    expect(safeRequestId(uuid)).toBe(uuid);
  });

  it("generates a new UUID when header is null", () => {
    const id = safeRequestId(null);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("rejects non-UUID header values and generates a fresh one", () => {
    const id = safeRequestId("not-a-uuid; injected log line");
    expect(id).not.toBe("not-a-uuid; injected log line");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
