import { describe, expect, it } from "vitest";
import type { NormalizedRecord, SearchProject } from "../../src/core/types";
import { parseImportedProject, sanitizeProjectForPersistence } from "../../src/persistence/database";

function makeNaraProject(): SearchProject {
  const record = {
    id: "nara-example",
    title: { value: "API-returned title", source: "NARA Catalog API", extractionMethod: "source_structured", confidence: 1 },
    date: { value: "1970-12-21", source: "NARA Catalog API", extractionMethod: "source_structured", confidence: 1 },
    sourceRepository: { value: "National Archives Catalog", source: "NARA Catalog API", extractionMethod: "source_structured", confidence: 1 },
    officialUrl: { value: "https://catalog.archives.gov/id/1634221", source: "NARA Catalog API", extractionMethod: "source_structured", confidence: 1 },
    recordPageUrl: { value: "https://catalog.archives.gov/id/1634221", source: "NARA Catalog API", extractionMethod: "source_structured", confidence: 1 },
    naraNaid: { value: "1634221", source: "NARA Catalog API", extractionMethod: "source_structured", confidence: 1 },
    releaseStatus: { status: "not_determined", determinationBasis: "test", source: "NARA Catalog API", confidence: 0.5, humanReview: true },
    exemptionCodes: [],
    classificationMarkings: [],
    extractedIdentifiers: ["1634221"],
    digitalObjects: [],
    provenance: {
      adapterId: "nara",
      sourceId: "nara",
      officialDomain: "catalog.archives.gov",
      officialRecordUrl: "https://catalog.archives.gov/id/1634221",
      retrievalTimestamp: "2026-07-29T00:00:00Z",
      normalizationVersion: "1.0.0"
    },
    retrievalTimestamp: "2026-07-29T00:00:00Z",
    confidenceScore: 82,
    matchExplanation: [{ label: "Exact title", points: 30, detail: "API-returned title matched" }],
    review: { disposition: "confirmed_match", notes: "Researcher-created note" }
  } satisfies NormalizedRecord;
  return {
    id: "project",
    name: "Test",
    createdAt: "2026-07-29T00:00:00Z",
    updatedAt: "2026-07-29T00:00:00Z",
    target: { mode: "quick", quickQuery: "test" },
    plan: { id: "plan", createdAt: "2026-07-29T00:00:00Z", target: { mode: "quick", quickQuery: "test" }, queries: [], sourceSelectionStrategy: [] },
    sourceRuns: [],
    rawRecords: [{ id: "raw", sourceId: "nara", retrievalTimestamp: "2026-07-29T00:00:00Z", payload: { title: "API-returned title" } }],
    records: [record],
    savedRecordIds: ["nara-example"],
    versionGroups: [],
    comparisons: [],
    notes: [],
    auditEvents: [],
    privateMode: false
  };
}

describe("NARA persistence boundary", () => {
  it("stores only a generated locator and researcher review data", () => {
    const project = makeNaraProject();
    project.versionGroups = [
      {
        id: "group",
        label: "API-returned title",
        recordIds: ["nara-example", "other-record"],
        relationships: [
          {
            id: "relationship",
            leftRecordId: "nara-example",
            rightRecordId: "other-record",
            label: "probable_version",
            score: 82,
            reasons: ["Same recorded date: 1970-12-21", "Similar available text (91%)"]
          }
        ],
        reviewStatus: "awaiting_review"
      }
    ];
    const saved = sanitizeProjectForPersistence(project);
    expect(saved.rawRecords).toEqual([]);
    expect(saved.records[0]).toMatchObject({
      title: { value: "NARA Catalog record 1634221" },
      confidenceScore: 0,
      matchExplanation: [],
      review: { disposition: "confirmed_match", notes: "Researcher-created note" }
    });
    expect(saved.records[0]).not.toHaveProperty("date");
    expect(saved.versionGroups[0]).toMatchObject({
      label: "Version group containing a saved NARA locator",
      relationships: [
        {
          label: "insufficient_evidence",
          score: 0,
          reasons: ["Live NARA-derived comparison evidence was not persisted; rerun the NARA search."]
        }
      ]
    });
    expect(JSON.stringify(saved)).not.toContain("API-returned title");
    expect(JSON.stringify(saved)).not.toContain("1970-12-21");
    expect(JSON.stringify(saved)).not.toContain("91%");
  });

  it("deep-validates imports and rejects URLs outside the registered source allowlist", () => {
    const valid = makeNaraProject();
    valid.fixture = true;
    valid.records[0].provenance.fixture = true;
    const imported = parseImportedProject(JSON.stringify(valid));
    expect(imported.records).toHaveLength(1);
    expect(imported.fixture).toBe(false);
    expect(imported.records[0].provenance).toMatchObject({
      fixture: false,
      importedUnverified: true
    });

    const malicious = structuredClone(valid);
    malicious.records[0].digitalObjects = [
      { id: "malicious", url: "https://catalog.archives.gov.evil.example/payload.pdf" }
    ];
    expect(() => parseImportedProject(JSON.stringify(malicious))).toThrow(/official-domain allowlist/);

    const forgedProvenance = structuredClone(valid);
    forgedProvenance.records[0].provenance.officialDomain = "evil.example";
    expect(() => parseImportedProject(JSON.stringify(forgedProvenance))).toThrow(/Provenance domain/);
  });

  it("enforces the import limit in UTF-8 bytes rather than JavaScript string length", () => {
    const oversizedUtf8 = "😀".repeat(5_000_001);
    expect(oversizedUtf8.length).toBeLessThan(20_000_000);
    expect(() => parseImportedProject(oversizedUtf8)).toThrow(/20 MB import limit/);
  });
});
