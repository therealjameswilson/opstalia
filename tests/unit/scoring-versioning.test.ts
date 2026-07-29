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
});
