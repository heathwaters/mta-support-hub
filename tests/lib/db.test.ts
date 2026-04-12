import { describe, it, expect } from "vitest";
import { cleanQ, escapeLike, isProductionWithoutSsl } from "@/lib/db";

describe("isProductionWithoutSsl", () => {
  it("returns true when SSL is false in production", () => {
    expect(isProductionWithoutSsl("false", "production")).toBe(true);
  });

  it("returns false when SSL is true in production", () => {
    expect(isProductionWithoutSsl("true", "production")).toBe(false);
  });

  it("returns false when SSL is false in development", () => {
    expect(isProductionWithoutSsl("false", "development")).toBe(false);
  });

  it("returns false when SSL is false in test", () => {
    expect(isProductionWithoutSsl("false", "test")).toBe(false);
  });

  it("returns false when NODE_ENV is undefined", () => {
    expect(isProductionWithoutSsl("false", undefined)).toBe(false);
  });

  it("returns false when SSL is true regardless of environment", () => {
    expect(isProductionWithoutSsl("true", "development")).toBe(false);
    expect(isProductionWithoutSsl("true", undefined)).toBe(false);
  });
});

describe("cleanQ", () => {
  it("returns null for null input", () => {
    expect(cleanQ(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(cleanQ("")).toBeNull();
  });

  it("returns null for strings shorter than 2 chars after trim", () => {
    expect(cleanQ(" a ")).toBeNull();
    expect(cleanQ("a")).toBeNull();
  });

  it("trims surrounding whitespace", () => {
    expect(cleanQ("  hello  ")).toBe("hello");
  });

  it("strips ASCII control characters (0x00–0x1F and 0x7F)", () => {
    expect(cleanQ("foo\u0000bar")).toBe("foobar");
    expect(cleanQ("line\u0009break")).toBe("linebreak");
    expect(cleanQ("del\u007fete")).toBe("delete");
  });

  it("slices to 100 characters max", () => {
    const long = "a".repeat(200);
    const result = cleanQ(long);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(100);
  });

  it("accepts a 2-char query", () => {
    expect(cleanQ("ab")).toBe("ab");
  });
});

describe("escapeLike", () => {
  it("escapes percent signs", () => {
    expect(escapeLike("50%")).toBe("50\\%");
  });

  it("escapes underscores", () => {
    expect(escapeLike("foo_bar")).toBe("foo\\_bar");
  });

  it("escapes backslashes", () => {
    expect(escapeLike("path\\file")).toBe("path\\\\file");
  });

  it("escapes multiple wildcards in a single string", () => {
    expect(escapeLike("%_\\")).toBe("\\%\\_\\\\");
  });

  it("leaves safe characters untouched", () => {
    expect(escapeLike("John Doe")).toBe("John Doe");
    expect(escapeLike("hello-world")).toBe("hello-world");
    expect(escapeLike("user@example.com")).toBe("user@example.com");
  });

  it("handles the empty string", () => {
    expect(escapeLike("")).toBe("");
  });
});
