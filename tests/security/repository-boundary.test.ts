import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { projectImportSchema, sanitizePlainText } from "../../src/core/validation";

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") return [];
    return entry.isDirectory() ? files(path) : [path];
  });
}

describe("repository security posture", () => {
  it("contains no likely committed API key material", () => {
    const keyPattern = /x-api-key["'\s:=]+(?!YOUR|REDACTED|placeholder)[A-Za-z0-9_-]{16,}/i;
    const findings = files(process.cwd())
      .filter((file) => statSync(file).size < 3_000_000)
      .filter((file) => keyPattern.test(readFileSync(file, "utf8")));
    expect(findings).toEqual([]);
  });

  it("sanitizes user text for plan display and rejects oversized invalid imports", () => {
    expect(sanitizePlainText("<script>alert(1)</script>\u0000 test")).toBe("scriptalert(1)/script test");
    expect(() => projectImportSchema.parse({ id: "x" })).toThrow();
  });

  it("ships a restrictive CSP and no remote font dependency", () => {
    const html = readFileSync(join(process.cwd(), "index.html"), "utf8");
    expect(html).toContain("object-src 'none'");
    expect(html).toContain("frame-ancestors 'none'");
    expect(html).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
  });
});
