import { describe, expect, it } from "vitest";
import type { NormalizedRecord, SearchProject } from "../../src/core/types";
import { projectToCsv, projectToMarkdown } from "../../src/reporting/exports";

function reportSection(markdown: string, heading: string, nextHeading: string): string {
  return markdown.split(heading)[1]?.split(nextHeading)[0] ?? "";
}

function makeProject(): SearchProject {
  const target = { mode: "quick" as const, quickQuery: "Malta Summit Scowcroft Bush" };
  const stateUrl =
    "https://foia.state.gov/FOIALIBRARY/SearchResults.aspx?searchText=Malta%20Summit%20Scowcroft%20Bush";
  return {
    id: "manual-source-report",
    name: "Manual source report",
    createdAt: "2026-07-29T12:00:00.000Z",
    updatedAt: "2026-07-29T12:05:00.000Z",
    target,
    plan: {
      id: "plan",
      createdAt: "2026-07-29T12:00:00.000Z",
      target,
      queries: [
        {
          id: "query",
          label: "Broad keywords",
          text: "Malta Summit Scowcroft Bush",
          kind: "broad_keyword",
          enabled: true,
          sourceIds: ["frus"],
          explanation: "Test query"
        }
      ],
      sourceSelectionStrategy: ["Search FRUS automatically and prepare official manual handoffs."]
    },
    sourceRuns: [
      {
        id: "frus-run",
        sourceId: "frus",
        status: "complete",
        resultCount: 2,
        message: "Two official FRUS results."
      },
      {
        id: "state-run",
        sourceId: "state-foia",
        status: "manual_available",
        resultCount: 0,
        message: "Prepared official State handoff.",
        manualSearchUrl: stateUrl,
        manualHandoff: {
          queryText: "Malta Summit Scowcroft Bush",
          queryUrl: stateUrl,
          appliedFilters: {
            "Document date from": "11-01-1989"
          },
          status: "prepared",
          warnings: ["Opstalia did not retrieve or count State results."]
        }
      },
      {
        id: "cia-run",
        sourceId: "cia",
        status: "temporarily_unavailable",
        resultCount: 1,
        message: "CIA Reading Room is unavailable upstream.",
        manualSearchUrl: "https://www.cia.gov/readingroom/advanced-search-view/",
        manualHandoff: {
          queryText: "Malta Summit Scowcroft Bush",
          queryUrl: "https://www.cia.gov/readingroom/advanced-search-view/",
          appliedFilters: {},
          status: "unavailable",
          researcherResultCount: 1,
          warnings: ["Retry after CIA restores the official service."]
        }
      },
      {
        id: "legacy-nsa-run",
        sourceId: "nsa",
        status: "manual_available",
        resultCount: 0,
        message: "Legacy manual-search link.",
        manualSearchUrl: "https://www.nsa.gov/Helpful-Links/NSA-FOIA/"
      }
    ],
    rawRecords: [],
    records: [],
    savedRecordIds: [],
    versionGroups: [],
    comparisons: [],
    notes: [],
    auditEvents: [],
    privateMode: false
  };
}

describe("manual-source research reporting", () => {
  it("separates automated, manual, and unavailable source runs and preserves the State handoff", () => {
    const markdown = projectToMarkdown(makeProject());
    const automated = reportSection(
      markdown,
      "## Automated sources searched",
      "## Manual official-source handoffs"
    );
    const manual = reportSection(
      markdown,
      "## Manual official-source handoffs",
      "## Sources unavailable"
    );
    const unavailable = reportSection(markdown, "## Sources unavailable", "## Results");

    expect(automated).toContain("- frus: complete (2 results)");
    expect(automated).not.toContain("state-foia");
    expect(automated).not.toContain("- cia:");
    expect(automated).not.toContain("- nsa:");

    expect(manual).toContain("- state-foia: prepared");
    expect(manual).toContain(
      "Official handoff: <https://foia.state.gov/FOIALIBRARY/SearchResults.aspx?searchText=Malta%20Summit%20Scowcroft%20Bush>"
    );
    expect(manual).toContain("Document date from: 11-01-1989");
    expect(manual).not.toContain("- cia:");
    expect(manual).toContain("- nsa: manual link available");
    expect(manual).toContain("Legacy saved run; no prepared handoff worksheet was stored.");

    expect(unavailable).toContain("- cia: temporarily_unavailable");
    expect(unavailable).toContain("Prepared retry text: Malta Summit Scowcroft Bush");
    expect(unavailable).toContain(
      "Researcher-recorded locators: 1 (this does not mean the unavailable source was searched)"
    );
    expect(unavailable).not.toContain("- state-foia:");
  });

  it("neutralizes spreadsheet formulas even after leading control or whitespace characters", () => {
    const project = makeProject();
    const maliciousRecord = {
      id: "malicious-csv",
      title: {
        value: "\t =HYPERLINK(\"https://evil.example\")",
        source: "Imported test",
        extractionMethod: "source_structured",
        confidence: 1
      },
      sourceRepository: {
        value: "Office of the Historian",
        source: "Imported test",
        extractionMethod: "source_structured",
        confidence: 1
      },
      officialUrl: {
        value: "https://history.state.gov/historicaldocuments/frus1981-88v05/d308",
        source: "Imported test",
        extractionMethod: "source_structured",
        confidence: 1
      },
      recordPageUrl: {
        value: "https://history.state.gov/historicaldocuments/frus1981-88v05/d308",
        source: "Imported test",
        extractionMethod: "source_structured",
        confidence: 1
      },
      releaseStatus: {
        status: "not_determined",
        determinationBasis: "Test",
        source: "Imported test",
        confidence: 0,
        humanReview: true
      },
      exemptionCodes: [],
      classificationMarkings: [],
      extractedIdentifiers: [],
      digitalObjects: [],
      provenance: {
        adapterId: "frus",
        sourceId: "frus",
        officialDomain: "history.state.gov",
        officialRecordUrl:
          "https://history.state.gov/historicaldocuments/frus1981-88v05/d308",
        retrievalTimestamp: "2026-07-29T12:00:00.000Z",
        normalizationVersion: "test"
      },
      retrievalTimestamp: "2026-07-29T12:00:00.000Z",
      confidenceScore: 0,
      matchExplanation: [],
      review: { disposition: "unreviewed" }
    } satisfies NormalizedRecord;
    project.records = [maliciousRecord];

    expect(projectToCsv(project)).toContain(
      "\"'\t =HYPERLINK(\"\"https://evil.example\"\")\""
    );
  });

  it("prevents imported text from forging Markdown sections, HTML, links, or code fences", () => {
    const project = makeProject();
    project.name = "Research\n## Forged heading";
    project.target.quickQuery = "```</code><img src=https://evil.example/pixel>";
    project.plan.target = { ...project.target };
    project.plan.queries[0].text = "Visible\n# Not a heading [click](https://evil.example)";
    project.sourceRuns[0].message = "<script>remote()</script>\n## Fake status";

    const markdown = projectToMarkdown(project);
    expect(markdown).not.toContain("\n## Forged heading");
    expect(markdown).not.toContain("\n# Not a heading");
    expect(markdown).not.toContain("<script>");
    expect(markdown).not.toContain("<img ");
    expect(markdown).not.toContain("[click](https://evil.example)");
    expect(markdown).toContain("````json");
    expect(markdown).toContain("\\u003cimg src=https://evil.example/pixel\\u003e");
  });
});
