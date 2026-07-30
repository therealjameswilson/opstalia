import { describe, expect, it } from "vitest";
import { sourceRegistry } from "../../src/data/registry";
import { assertSafeOutboundUrl, domainMatches, isApprovedOfficialUrl, validatePrimaryEvidence } from "../../src/security/url-policy";
import { normalizeError, redactSecrets } from "../../src/security/redaction";

describe("official-domain and secret boundaries", () => {
  const nara = sourceRegistry.find((source) => source.id === "nara")!;

  it("accepts exact or subordinate official domains, not suffix tricks", () => {
    expect(domainMatches("catalog.archives.gov", "archives.gov")).toBe(true);
    expect(domainMatches("archives.gov.evil.example", "archives.gov")).toBe(false);
    expect(isApprovedOfficialUrl("https://catalog.archives.gov/id/1", nara)).toBe(true);
    expect(isApprovedOfficialUrl("http://catalog.archives.gov/id/1", nara)).toBe(false);
    expect(isApprovedOfficialUrl("https://wikileaks.org/file", nara)).toBe(false);
  });

  it("requires registered adapter provenance and an official URL", () => {
    const provenance = {
      adapterId: "nara",
      sourceId: "nara",
      officialDomain: "catalog.archives.gov",
      officialRecordUrl: "https://catalog.archives.gov/id/1",
      retrievalTimestamp: "2026-07-29T00:00:00Z",
      normalizationVersion: "1"
    };
    expect(validatePrimaryEvidence(provenance.officialRecordUrl, provenance, nara).allowed).toBe(true);
    expect(validatePrimaryEvidence("https://example.com/file", provenance, nara).allowed).toBe(false);
    expect(validatePrimaryEvidence(provenance.officialRecordUrl, { ...provenance, adapterId: "cia" }, nara).allowed).toBe(false);
  });

  it("blocks SSRF targets and redacts credentials from errors", () => {
    expect(() => assertSafeOutboundUrl("https://169.254.169.254/latest/meta-data", ["catalog.archives.gov"])).toThrow(/SSRF/);
    expect(redactSecrets("x-api-key: SUPERSECRET123 authorization=Bearer ABCDEF")).not.toContain("SUPERSECRET123");
    expect(normalizeError(new Error("429 rate limit")).code).toBe("SOURCE_RATE_LIMIT");
  });

  it("keeps every registry access link on its source's approved official domains", () => {
    for (const source of sourceRegistry) {
      expect(isApprovedOfficialUrl(source.manualSearchUrl, source), `${source.id} manual link`).toBe(true);
      for (const link of source.officialAccessLinks ?? []) {
        expect(isApprovedOfficialUrl(link.url, source), `${source.id} ${link.label}`).toBe(true);
      }
    }
  });
});
