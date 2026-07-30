import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { projectImportSchema, sanitizePlainText } from "../../src/core/validation";
import { redactSecrets } from "../../src/security/redaction";

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
  }, 30_000);

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

  it("redacts every configured Worker secret and GovInfo query-key form", () => {
    const redacted = redactSecrets(
      "NARA_API_KEY=nara-secret GOVINFO_API_KEY=gov-secret " +
        "CLOUDFLARE_API_TOKEN=cloudflare-secret RATE_LIMIT_SALT=rate-secret " +
        "https://api.govinfo.gov/search?api_key=url-secret&format=json"
    );
    expect(redacted).not.toContain("nara-secret");
    expect(redacted).not.toContain("gov-secret");
    expect(redacted).not.toContain("cloudflare-secret");
    expect(redacted).not.toContain("rate-secret");
    expect(redacted).not.toContain("url-secret");
    expect(redacted).toContain("api_key=[REDACTED]");
  });

  it("keeps the NARA JFK index free of unofficial evidence URLs", () => {
    const indexPath = join(
      process.cwd(),
      "public/data/indexes/jfk-2025.json"
    );
    expect(existsSync(indexPath)).toBe(true);
    const index = readFileSync(indexPath, "utf8");
    expect(index).not.toMatch(
      /(?:doctly(?:\.ai|\.com)|github\.com\/doctly|raw\.githubusercontent\.com\/doctly)/i
    );
    const parsed = JSON.parse(index) as {
      records: Array<{ officialUrl: string; recordPageUrl: string }>;
    };
    expect(parsed.records.length).toBeGreaterThanOrEqual(2_000);
    parsed.records.forEach((record) => {
      expect(new URL(record.officialUrl).hostname).toBe("www.archives.gov");
      expect(record.recordPageUrl).toBe(
        "https://www.archives.gov/research/jfk/release-2025"
      );
    });
  });
});
