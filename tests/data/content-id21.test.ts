import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function loadFile(rel: string): string {
  return readFileSync(path.join(REPO_ROOT, rel), "utf8");
}

/**
 * Extracts the `cr` (canned response) string for entry id:21 from a support-hub HTML file.
 * The data is stored as JS object literals inside a <script> tag with backtick-delimited strings.
 */
function extractId21Cr(src: string): string {
  const entryStart = src.indexOf("{id:21,");
  expect(entryStart, "id:21 entry must exist").toBeGreaterThan(-1);
  const crMarker = src.indexOf("cr:`", entryStart);
  expect(crMarker, "cr field must exist on id:21").toBeGreaterThan(-1);
  const bodyStart = crMarker + 4;
  const bodyEnd = src.indexOf("`", bodyStart);
  expect(bodyEnd, "cr field must be closed").toBeGreaterThan(bodyStart);
  return src.slice(bodyStart, bodyEnd);
}

describe("support-hub content: entry id:21 (address change)", () => {
  describe("public/support-hub.html", () => {
    const src = loadFile("public/support-hub.html");
    const cr = extractId21Cr(src);

    it("does not include the old unkeepable 'right now' promise", () => {
      expect(cr).not.toMatch(/right now/i);
    });

    it("does not leak agent-facing meta-instruction to the customer", () => {
      expect(cr).not.toMatch(/if no specialist/i);
    });

    it("states the team will update manually", () => {
      expect(cr.toLowerCase()).toContain("our team will update this manually");
    });

    it("includes an email confirmation expectation", () => {
      expect(cr.toLowerCase()).toContain("email confirmation");
    });

    it("uses real newlines between the 6 numbered items", () => {
      expect(cr).toMatch(/\\n1\./);
      expect(cr).toMatch(/\\n6\./);
    });

    it("requests all 6 required fields", () => {
      expect(cr).toMatch(/1\. First and Last Name Associated with account/);
      expect(cr).toMatch(/2\. Email Associated with account/);
      expect(cr).toMatch(/3\. Player First and Last Name/);
      expect(cr).toMatch(/4\. Player USTA Number/);
      expect(cr).toMatch(/5\. New City and State/);
      expect(cr).toMatch(/6\. New District and Section/);
    });

    it("does not start with the per-entry {name} greeting (file convention)", () => {
      expect(cr).not.toMatch(/^Hi \{name\}/);
    });
  });

  describe("match-tennis-support-hub.html", () => {
    const src = loadFile("public/match-tennis-support-hub.html");
    const cr = extractId21Cr(src);

    it("preserves the {name} greeting prefix (file convention)", () => {
      expect(cr).toMatch(/^Hi \{name\}, thank you for contacting Match Tennis Support!/);
    });

    it("includes the 'I can help with your address update' acknowledgement", () => {
      expect(cr).toContain("I can help with your address update");
    });

    it("does not include the old unkeepable 'right now' promise", () => {
      expect(cr).not.toMatch(/right now/i);
    });

    it("does not leak agent-facing meta-instruction to the customer", () => {
      expect(cr).not.toMatch(/if no specialist/i);
    });

    it("uses real newlines between the 6 numbered items", () => {
      expect(cr).toMatch(/\\n1\./);
      expect(cr).toMatch(/\\n6\./);
    });

    it("includes the email confirmation expectation", () => {
      expect(cr.toLowerCase()).toContain("email confirmation");
    });

    it("requests all 6 required fields", () => {
      expect(cr).toMatch(/1\. First and Last Name Associated with account/);
      expect(cr).toMatch(/2\. Email Associated with account/);
      expect(cr).toMatch(/3\. Player First and Last Name/);
      expect(cr).toMatch(/4\. Player USTA Number/);
      expect(cr).toMatch(/5\. New City and State/);
      expect(cr).toMatch(/6\. New District and Section/);
    });
  });
});

describe("support-hub content: id:21 agent tip", () => {
  it("public/support-hub.html: at field mentions the delete-existing-lines tip", () => {
    const src = loadFile("public/support-hub.html");
    const start = src.indexOf("{id:21,");
    const end = src.indexOf("{id:", start + 1);
    const entry = src.slice(start, end);
    expect(entry).toMatch(/delete those lines before pasting/i);
  });

  it("match-tennis-support-hub.html: at field mentions the delete-existing-lines tip", () => {
    const src = loadFile("public/match-tennis-support-hub.html");
    const start = src.indexOf("{id:21,");
    const end = src.indexOf("{id:", start + 1);
    const entry = src.slice(start, end);
    expect(entry).toMatch(/delete those lines before pasting/i);
  });
});
