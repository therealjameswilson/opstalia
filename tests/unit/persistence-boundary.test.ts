import { describe, expect, it } from "vitest";
import type { NormalizedRecord, SearchProject } from "../../src/core/types";
import { parseImportedProject, sanitizeProjectForPersistence } from "../../src/persistence/database";
import { sourceRegistry } from "../../src/data/registry";
import { createManualOfficialRecord } from "../../src/search/manual-record";
import { projectToCsv, projectToMarkdown } from "../../src/reporting/exports";

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
    expect(projectToMarkdown(imported)).toContain(
      "official-domain checked, but source retrieval and provenance were not revalidated"
    );
    expect(projectToCsv(imported)).toContain("provenance_verification");
    expect(projectToCsv(imported)).toContain("imported_source_not_revalidated");

    const malicious = structuredClone(valid);
    malicious.records[0].digitalObjects = [
      { id: "malicious", url: "https://catalog.archives.gov.evil.example/payload.pdf" }
    ];
    expect(() => parseImportedProject(JSON.stringify(malicious))).toThrow(/official-domain allowlist/);

    const forgedProvenance = structuredClone(valid);
    forgedProvenance.records[0].provenance.officialDomain = "evil.example";
    expect(() => parseImportedProject(JSON.stringify(forgedProvenance))).toThrow(/Provenance domain/);

    const maliciousOverride = structuredClone(valid);
    maliciousOverride.records[0].officialUrl.researcherOverride = {
      value: "https://evil.example/fake-record",
      basis: "Crafted import",
      timestamp: "2026-07-29T00:00:00Z"
    };
    expect(() => parseImportedProject(JSON.stringify(maliciousOverride))).toThrow(
      /official-URL override outside.*official-domain allowlist/
    );
  });

  it("enforces the import limit in UTF-8 bytes rather than JavaScript string length", () => {
    const oversizedUtf8 = "😀".repeat(5_000_001);
    expect(oversizedUtf8.length).toBeLessThan(20_000_000);
    expect(() => parseImportedProject(oversizedUtf8)).toThrow(/20 MB import limit/);
  });

  it("reconciles imported manual-run claims and rejects non-record manual URLs", () => {
    const project = makeNaraProject();
    const state = sourceRegistry.find((source) => source.id === "state-foia")!;
    const stateRecord = createManualOfficialRecord(
      state,
      { mode: "quick", quickQuery: "Malta" },
      {
        title: "Official-informal",
        officialUrl:
          "https://foia.state.gov/DOCUMENTS/1-FY2012/F-2011-01588/DOC_0C17684682/C17684682.pdf"
      }
    );
    project.records.push(stateRecord);
    project.savedRecordIds.push(stateRecord.id);
    project.plan.queries = [
      {
        id: "manual-query",
        label: "Manual query",
        text: "Q".repeat(500),
        kind: "broad_keyword",
        enabled: true,
        sourceIds: ["state-foia"],
        explanation: "Import boundary test"
      }
    ];
    project.sourceRuns = [
      {
        id: "state-run",
        sourceId: "state-foia",
        status: "manual_available",
        resultCount: 999,
        manualSearchUrl: "https://foia.state.gov/FOIALIBRARY/SearchResults.aspx",
        manualHandoff: {
          queryText: "Q".repeat(1000),
          queryUrl:
            "https://foia.state.gov/FOIALIBRARY/SearchResults.aspx?searchText=Malta",
          appliedFilters: {},
          status: "completed",
          openedAt: "2026-07-29T00:00:00Z",
          completedAt: "2026-07-29T00:01:00Z",
          researcherResultCount: 999,
          warnings: []
        }
      }
    ];

    const imported = parseImportedProject(JSON.stringify(project));
    expect(imported.sourceRuns[0]).toMatchObject({
      status: "manual_available",
      resultCount: 1,
      message: "Imported manual handoff; source status and prior search activity were not revalidated.",
      manualHandoff: {
        queryText: "Q".repeat(350),
        status: "prepared",
        researcherResultCount: 1
      }
    });
    expect(imported.sourceRuns[0].manualHandoff?.openedAt).toBeUndefined();
    expect(imported.sourceRuns[0].manualHandoff?.completedAt).toBeUndefined();

    const forgedSearchPage = structuredClone(project);
    const forgedRecord = forgedSearchPage.records[1];
    const searchUrl =
      "https://foia.state.gov/FOIALIBRARY/SearchResults.aspx?searchText=Malta";
    forgedRecord.officialUrl.value = searchUrl;
    forgedRecord.recordPageUrl.value = searchUrl;
    forgedRecord.provenance.officialRecordUrl = searchUrl;
    forgedRecord.provenance.normalizationVersion = "attacker-controlled-version";
    expect(() => parseImportedProject(JSON.stringify(forgedSearchPage))).toThrow(
      /Imported researcher locator|direct State released-document PDF/
    );

    const credentialedHandoff = structuredClone(project);
    credentialedHandoff.sourceRuns[0].manualHandoff!.queryUrl =
      "https://user:pass@foia.state.gov/FOIALIBRARY/SearchResults.aspx";
    expect(() => parseImportedProject(JSON.stringify(credentialedHandoff))).toThrow(
      /not tied to a registered official source/
    );

    const handoffOnAutomatedSource = structuredClone(project);
    handoffOnAutomatedSource.sourceRuns[0] = {
      ...handoffOnAutomatedSource.sourceRuns[0],
      sourceId: "nara"
    };
    expect(() => parseImportedProject(JSON.stringify(handoffOnAutomatedSource))).toThrow(
      /not tied to a registered official source/
    );

    const hiddenTarget = structuredClone(project);
    hiddenTarget.plan.target.quickQuery = "HIDDEN TRANSMITTED TERM";
    expect(() => parseImportedProject(JSON.stringify(hiddenTarget))).toThrow(
      /target does not match its search-plan target/
    );
  });
});
