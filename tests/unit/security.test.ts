import { describe, expect, it } from "vitest";
import sourceData from "../../data/sources.json";
import type { NormalizedRecord } from "../../src/core/types";
import { sourceRegistryDataSchema } from "../../src/core/validation";
import { sourceRegistry } from "../../src/data/registry";
import {
  assertSafeOutboundUrl,
  canonicalNtrsDownloadPath,
  domainMatches,
  isApprovedOfficialUrl,
  validateNormalizedRecordEvidence,
  validatePrimaryEvidence
} from "../../src/security/url-policy";
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

  it("canonicalizes safe NTRS downloads and rejects encoded path confusion", () => {
    expect(
      canonicalNtrsDownloadPath(
        "/api/citations/123/downloads/report%20final.pdf",
        "123"
      )
    ).toBe("/api/citations/123/downloads/report%20final.pdf");
    expect(
      canonicalNtrsDownloadPath(
        "/api/citations/123/downloads/r%C3%A9sum%C3%A9.pdf",
        "123"
      )
    ).toBe("/api/citations/123/downloads/r%C3%A9sum%C3%A9.pdf");

    const rejected = [
      "/api/citations/999/downloads/report.pdf",
      "/api/citations/123/downloads/.",
      "/api/citations/123/downloads/%2e%2e",
      "/api/citations/123/downloads/%2F..%2Fother.pdf",
      "/api/citations/123/downloads/%5C..%5Cother.pdf",
      "/api/citations/123/downloads/%252Fdouble-encoded.pdf",
      "/api/citations/123/downloads/malformed%.pdf"
    ];
    rejected.forEach((path) => {
      expect(canonicalNtrsDownloadPath(path, "123"), path).toBeUndefined();
    });
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

  it("rejects an unofficial embedded file URL even when the record page is official", () => {
    const officialUrl = "https://catalog.archives.gov/id/1";
    const record = {
      id: "record-1",
      title: {
        value: "Official test record",
        source: "test",
        extractionMethod: "source_structured",
        confidence: 1
      },
      sourceRepository: {
        value: "National Archives Catalog",
        source: "test",
        extractionMethod: "source_structured",
        confidence: 1
      },
      officialUrl: {
        value: officialUrl,
        source: "test",
        extractionMethod: "source_structured",
        confidence: 1
      },
      recordPageUrl: {
        value: officialUrl,
        source: "test",
        extractionMethod: "source_structured",
        confidence: 1
      },
      releaseStatus: {
        status: "not_determined",
        determinationBasis: "test",
        source: "test",
        confidence: 1,
        humanReview: true
      },
      exemptionCodes: [],
      classificationMarkings: [],
      extractedIdentifiers: [],
      digitalObjects: [
        {
          id: "object-1",
          url: "https://evil.example/document.pdf"
        }
      ],
      provenance: {
        adapterId: "nara",
        sourceId: "nara",
        officialDomain: "catalog.archives.gov",
        officialRecordUrl: officialUrl,
        retrievalTimestamp: "2026-07-29T00:00:00Z",
        normalizationVersion: "1"
      },
      retrievalTimestamp: "2026-07-29T00:00:00Z",
      confidenceScore: 0,
      matchExplanation: [],
      review: { disposition: "unreviewed" }
    } as NormalizedRecord;
    expect(validateNormalizedRecordEvidence(record, nara)).toMatchObject({
      allowed: false,
      reason: expect.stringContaining("digital object 1")
    });
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

  it("runtime-validates source registry shape, unique IDs, and automated status claims", () => {
    expect(sourceRegistryDataSchema.safeParse(sourceData).success).toBe(true);
    const duplicate = structuredClone(sourceData);
    duplicate.sources.push(structuredClone(duplicate.sources[0]));
    expect(sourceRegistryDataSchema.safeParse(duplicate).success).toBe(false);
    const misleading = structuredClone(sourceData);
    misleading.sources[0].adapterStatus = "manual";
    expect(sourceRegistryDataSchema.safeParse(misleading).success).toBe(false);
  });
});
