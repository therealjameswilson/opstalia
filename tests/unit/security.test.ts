import { describe, expect, it } from "vitest";
import sourceData from "../../data/sources.json";
import type { NormalizedRecord } from "../../src/core/types";
import { sourceRegistryDataSchema } from "../../src/core/validation";
import { sourceRegistry } from "../../src/data/registry";
import {
  assertSafeOutboundUrl,
  canonicalNaraJfkReleasePdf,
  canonicalNtrsDownloadPath,
  domainMatches,
  isApprovedOfficialUrl,
  validateNaraPresidentialLibraryPacket,
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

  it("binds NARA JFK release files to strict official paths and RIF identifiers", () => {
    const safe =
      "https://www.archives.gov/files/research/jfk/releases/2025/0318/124-10167-10383%20(DocID%2032989663).PDF";
    expect(canonicalNaraJfkReleasePdf(safe)).toMatchObject({
      fileName: "124-10167-10383 (DocID 32989663).PDF",
      rifNumber: "124-10167-10383"
    });
    [
      "https://doctly.ai/jfk/124-10167-10383.pdf",
      "https://github.com/doctly/jfk/124-10167-10383.pdf",
      "https://raw.githubusercontent.com/doctly/jfk/main/124-10167-10383.pdf",
      "https://archives.gov.evil.example/files/research/jfk/releases/2025/0318/124-10167-10383.pdf",
      "https://www.archives.gov/research/jfk/release-2025",
      "https://www.archives.gov/files/other/124-10167-10383.pdf",
      "https://www.archives.gov/files/research/jfk/releases/2025/0320/124-10167-10383.pdf",
      "https://www.archives.gov/files/research/jfk/releases/2026/0130/124-10167-10383.pdf",
      "https://www.archives.gov/files/research/jfk/releases/2025/0318/%2F124-10167-10383.pdf",
      "https://www.archives.gov/files/research/jfk/releases/2025/0318/%252F124-10167-10383.pdf",
      "https://www.archives.gov/files/research/jfk/releases/2025/0318/124-10167-10383.pdf?download=1"
    ].forEach((url) => {
      expect(canonicalNaraJfkReleasePdf(url), url).toBeUndefined();
    });
  });

  it("rejects a NARA JFK result whose file path and normalized RIF do not agree", () => {
    const source = sourceRegistry.find(
      (entry) => entry.id === "nara-jfk-2025"
    )!;
    const officialUrl =
      "https://www.archives.gov/files/research/jfk/releases/2025/0318/104-10003-10041.pdf";
    const record = {
      id: "nara-jfk-test",
      title: {
        value: "104-10003-10041.pdf",
        source: "NARA release table",
        extractionMethod: "source_structured",
        confidence: 1
      },
      sourceRepository: {
        value: "National Archives and Records Administration",
        source: "NARA release table",
        extractionMethod: "source_structured",
        confidence: 1
      },
      officialUrl: {
        value: officialUrl,
        source: "NARA release table",
        extractionMethod: "source_structured",
        confidence: 1
      },
      downloadUrl: {
        value: officialUrl,
        source: "NARA release table",
        extractionMethod: "source_structured",
        confidence: 1
      },
      recordPageUrl: {
        value: "https://www.archives.gov/research/jfk/release-2025",
        source: "NARA release table",
        extractionMethod: "source_structured",
        confidence: 1
      },
      documentNumber: {
        value: "104-10003-10041",
        source: "NARA release filename",
        extractionMethod: "source_structured",
        confidence: 1
      },
      releaseStatus: {
        status: "not_determined",
        determinationBasis: "Record-specific release completeness is unknown.",
        source: "NARA release table",
        confidence: 0.4,
        humanReview: true
      },
      exemptionCodes: [],
      classificationMarkings: [],
      extractedIdentifiers: ["104-10003-10041"],
      digitalObjects: [
        {
          id: "object-jfk",
          url: officialUrl,
          downloadUrl: officialUrl,
          mediaType: "application/pdf"
        }
      ],
      provenance: {
        adapterId: "nara-jfk-2025",
        sourceId: "nara-jfk-2025",
        officialDomain: "www.archives.gov",
        officialRecordUrl: officialUrl,
        retrievalTimestamp: "2026-07-30T00:00:00Z",
        normalizationVersion: "test"
      },
      retrievalTimestamp: "2026-07-30T00:00:00Z",
      confidenceScore: 0,
      matchExplanation: [],
      review: { disposition: "unreviewed" }
    } as NormalizedRecord;
    expect(validateNormalizedRecordEvidence(record, source).allowed).toBe(true);
    record.digitalObjects[0].url =
      "https://www.archives.gov/files/research/jfk/releases/2025/0318/104-10003-10041_multirif.pdf";
    expect(validateNormalizedRecordEvidence(record, source)).toMatchObject({
      allowed: false,
      reason: expect.stringContaining("filename RIF")
    });
    record.digitalObjects[0].url = officialUrl;
    record.documentNumber!.value = "104-10003-99999";
    expect(validateNormalizedRecordEvidence(record, source)).toMatchObject({
      allowed: false,
      reason: expect.stringContaining("filename RIF")
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

describe("NARA presidential-library packet admission", () => {
  const presidentialLibraries = {
    id: "presidential-libraries",
    displayName: "NARA Presidential Libraries",
    agency: "NARA",
    officialDomains: ["archives.gov", "catalog.archives.gov", "bush41library.gov"],
    description: "Official packets",
    searchCapability: "manual" as const,
    apiAvailability: "NARA Catalog",
    authentication: "None",
    rateLimit: "Not published",
    robotsAndTerms: "No scraping",
    adapterStatus: "manual" as const,
    implementationMethod: "Packet lab",
    supportedFilters: [],
    fieldsReturned: [],
    knownLimitations: [],
    manualSearchUrl: "https://www.archives.gov/presidential-libraries/visit/websites.html",
    lastValidated: "2026-08-03",
    enabledByDefault: true
  };

  it("binds an exact medialz packet path to its matching NAID record", () => {
    expect(validateNaraPresidentialLibraryPacket({
      naraNaid: "470761856",
      officialRecordUrl: "https://catalog.archives.gov/id/470761856",
      officialPdfUrl: "https://catalog.archives.gov/medialz/presidential-libraries/bush/gb-nsc/example.pdf"
    }, presidentialLibraries)).toMatchObject({ allowed: true });
  });

  it.each([
    "https://catalog.archives.gov/id/470761856.pdf",
    "https://catalog.archives.gov/medialz/other/example.pdf",
    "https://catalog.archives.gov.evil.example/medialz/presidential-libraries/bush/example.pdf",
    "https://catalog.archives.gov/medialz/presidential-libraries/bush/example.pdf?token=secret",
    "https://catalog.archives.gov/medialz/presidential-libraries/bush/%252e%252e%252fexample.pdf"
  ])("rejects an unsupported or deceptive packet URL: %s", (officialPdfUrl) => {
    expect(validateNaraPresidentialLibraryPacket({
      naraNaid: "470761856",
      officialRecordUrl: "https://catalog.archives.gov/id/470761856",
      officialPdfUrl
    }, presidentialLibraries).allowed).toBe(false);
  });

  it("rejects a Catalog record URL that does not match the supplied NAID", () => {
    expect(validateNaraPresidentialLibraryPacket({
      naraNaid: "470761856",
      officialRecordUrl: "https://catalog.archives.gov/id/470761855",
      officialPdfUrl: "https://catalog.archives.gov/medialz/presidential-libraries/bush/example.pdf"
    }, presidentialLibraries).allowed).toBe(false);
  });
});
