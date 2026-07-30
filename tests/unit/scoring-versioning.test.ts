import { describe, expect, it } from "vitest";
import type { NormalizedRecord } from "../../src/core/types";
import { scoreRecord } from "../../src/analysis/scoring";
import { compareVersions, deduplicateRecords, groupVersions } from "../../src/analysis/versioning";

function record(overrides: Partial<NormalizedRecord> = {}): NormalizedRecord {
  return {
    id: overrides.id ?? "record-1",
    title: { value: "Memorandum from Scowcroft to Bush", source: "official", extractionMethod: "source_reported", confidence: 1 },
    date: { value: "1989-12-03", source: "official", extractionMethod: "source_reported", confidence: 1 },
    authorSender: { value: ["Brent Scowcroft"], source: "official", extractionMethod: "source_reported", confidence: 1 },
    recipient: { value: ["George Bush"], source: "official", extractionMethod: "source_reported", confidence: 1 },
    documentNumber: { value: "NSC-123", source: "official", extractionMethod: "source_reported", confidence: 1 },
    sourceRepository: { value: "Official Repository", source: "official", extractionMethod: "source_reported", confidence: 1 },
    officialUrl: { value: `https://archives.gov/${overrides.id ?? "1"}`, source: "official", extractionMethod: "source_reported", confidence: 1 },
    recordPageUrl: { value: `https://archives.gov/${overrides.id ?? "1"}`, source: "official", extractionMethod: "source_reported", confidence: 1 },
    releaseStatus: { status: "not_determined", determinationBasis: "unknown", source: "official", confidence: 0.5, humanReview: true },
    exemptionCodes: [],
    classificationMarkings: [],
    extractedIdentifiers: ["NSC-123"],
    digitalObjects: [],
    provenance: {
      adapterId: "iscap",
      sourceId: "iscap",
      officialDomain: "archives.gov",
      officialRecordUrl: `https://archives.gov/${overrides.id ?? "1"}`,
      retrievalTimestamp: "2026-07-29T00:00:00Z",
      normalizationVersion: "1"
    },
    retrievalTimestamp: "2026-07-29T00:00:00Z",
    confidenceScore: 0,
    matchExplanation: [],
    review: { disposition: "unreviewed" },
    ...overrides
  };
}

describe("explainable scoring and versioning", () => {
  it("shows positive and negative scoring factors", () => {
    const result = scoreRecord(record(), {
      mode: "guided",
      titleOrSubject: "Memorandum from Scowcroft to Bush",
      authorSender: "Scowcroft",
      recipient: "Bush",
      identifiers: "NSC-123",
      dateFrom: "1990-12-03"
    });
    expect(result.factors).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Exact identifier match", points: 35 }),
      expect.objectContaining({ label: "Date conflict", points: -10 })
    ]));
    expect(result.score).toBeGreaterThan(40);
  });

  it("requires strong evidence before confirming the same document", () => {
    const left = record({ id: "left" });
    const right = record({ id: "right", officialUrl: { value: "https://archives.gov/right", source: "official", extractionMethod: "source_reported", confidence: 1 } });
    const relationship = compareVersions(left, right);
    expect(relationship.score).toBeGreaterThanOrEqual(72);
    expect(relationship.reasons).toContain("Same identifier: nsc 123");
  });

  it("deduplicates exact adapter-and-URL records but groups versions from different URLs", () => {
    const left = record({ id: "left" });
    const duplicate = record({ id: "duplicate" });
    duplicate.provenance.officialRecordUrl = left.provenance.officialRecordUrl;
    duplicate.officialUrl = left.officialUrl;
    expect(deduplicateRecords([left, duplicate])).toHaveLength(1);
    const version = record({ id: "version" });
    expect(groupVersions([left, version])).toHaveLength(1);
  });

  it("never calls distinct NARA JFK files confirmed identical on a shared base RIF alone", () => {
    const jfkRecord = (id: string, suffix: string) => {
      const item = record({
        id,
        title: {
          value: `124-10274-10029${suffix}.pdf`,
          source: "NARA release table",
          extractionMethod: "source_structured",
          confidence: 1
        },
        documentNumber: {
          value: "124-10274-10029",
          source: "NARA release filename",
          extractionMethod: "source_structured",
          confidence: 1
        },
        extractedIdentifiers: ["124-10274-10029"],
        textSnippet: {
          value: `Official NARA filename 124-10274-10029${suffix}.pdf`,
          source: "NARA release table",
          extractionMethod: "source_structured",
          confidence: 1
        }
      });
      const officialUrl = `https://www.archives.gov/files/research/jfk/releases/2025/0318/124-10274-10029${suffix}.pdf`;
      item.officialUrl.value = officialUrl;
      item.recordPageUrl.value =
        "https://www.archives.gov/research/jfk/release-2025";
      item.provenance = {
        adapterId: "nara-jfk-2025",
        sourceId: "nara-jfk-2025",
        officialDomain: "www.archives.gov",
        officialRecordUrl: officialUrl,
        retrievalTimestamp: "2026-07-30T00:00:00Z",
        normalizationVersion: "1.2.0-nara-jfk-release-index"
      };
      return item;
    };
    const relationship = compareVersions(
      jfkRecord("jfk-plain", ""),
      jfkRecord("jfk-multirif", "_multirif_redacted")
    );
    expect(relationship).toMatchObject({
      label: "probable_version",
      score: 78
    });
    expect(relationship.reasons.join(" ")).toMatch(
      /not automatically identical/i
    );
  });

  it("deduplicates the same NARA Catalog record across generic and scoped profiles", () => {
    const generic = record({
      id: "nara-generic",
      naraNaid: {
        value: "1634221",
        source: "NARA Catalog API",
        extractionMethod: "source_structured",
        confidence: 1
      },
      provenance: {
        adapterId: "nara",
        sourceId: "nara",
        officialDomain: "catalog.archives.gov",
        officialRecordUrl: "https://catalog.archives.gov/id/1634221",
        retrievalTimestamp: "2026-07-29T00:00:00Z",
        normalizationVersion: "1.0.0-nara-catalog"
      },
      officialUrl: {
        value: "https://catalog.archives.gov/id/1634221",
        source: "NARA Catalog API",
        extractionMethod: "source_structured",
        confidence: 1
      }
    });
    const profile = {
      ...structuredClone(generic),
      id: "nara-cia-profile",
      sourceRepository: {
        value: "National Archives Catalog — Records of the Central Intelligence Agency (RG 263)",
        source: "NARA Catalog API",
        extractionMethod: "source_structured" as const,
        confidence: 1
      },
      provenance: {
        ...generic.provenance,
        adapterId: "nara-cia-rg263",
        sourceId: "nara-cia-rg263"
      }
    };

    expect(deduplicateRecords([generic, profile])).toEqual([
      expect.objectContaining({
        id: "nara-cia-profile",
        provenance: expect.objectContaining({ sourceId: "nara-cia-rg263" })
      })
    ]);

    const unverifiedProfile = {
      ...structuredClone(profile),
      id: "nara-cia-unverified",
      sourceRepository: {
        value: "National Archives Catalog",
        source: "NARA Catalog API",
        extractionMethod: "source_structured" as const,
        confidence: 1
      }
    };
    expect(deduplicateRecords([unverifiedProfile, generic])).toEqual([
      expect.objectContaining({
        id: "nara-generic",
        provenance: expect.objectContaining({ sourceId: "nara" })
      })
    ]);
  });
});
