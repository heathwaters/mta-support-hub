import { describe, it, expect } from "vitest";
import { cleanQ, escapeLike, assertProductionSsl } from "@/lib/db";

describe("assertProductionSsl", () => {
  it("throws when SSL is false in production (MTA)", () => {
    expect(() => assertProductionSsl("MTA", "false", "production")).toThrow(
      /MTA_MYSQL_SSL must be "true" in production/
    );
  });

  it("throws when SSL is false in production (MTT)", () => {
    expect(() => assertProductionSsl("MTT", "false", "production")).toThrow(
      /MTT_MYSQL_SSL must be "true" in production/
    );
  });

  it("does not throw when SSL is true in production", () => {
    expect(() => assertProductionSsl("MTA", "true", "production")).not.toThrow();
    expect(() => assertProductionSsl("MTT", "true", "production")).not.toThrow();
  });

  it("does not throw when SSL is false in development", () => {
    expect(() => assertProductionSsl("MTA", "false", "development")).not.toThrow();
  });

  it("does not throw when SSL is false in test", () => {
    expect(() => assertProductionSsl("MTA", "false", "test")).not.toThrow();
  });

  it("does not throw when NODE_ENV is undefined", () => {
    expect(() => assertProductionSsl("MTA", "false", undefined)).not.toThrow();
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
