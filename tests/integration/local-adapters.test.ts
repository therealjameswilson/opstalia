import { afterEach, describe, expect, it, vi } from "vitest";
import frusIndex from "../fixtures/frus-index.json";
import {
  searchFrus,
  searchJfk2025
} from "../../src/search/local-adapters";
import type { NormalizedSearchQuery } from "../../src/core/types";
import { sourceRegistry } from "../../src/data/registry";

const query: NormalizedSearchQuery = {
  target: {
    mode: "guided",
    titleOrSubject: "Reykjavik memorandum",
    dateFrom: "1986-10-12",
    generalKeywords: "Reagan Gorbachev"
  },
  query: {
    id: "q",
    label: "Reykjavik",
    text: "Reykjavik Reagan Gorbachev",
    kind: "broad_keyword",
    enabled: true,
    sourceIds: ["frus"],
    explanation: "fixture"
  },
  limit: 20,
  privateMode: false
};

afterEach(() => vi.restoreAllMocks());

describe("local official-source indexes", () => {
  it("normalizes a recorded FRUS TEI-derived fixture", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(frusIndex), { status: 200, headers: { "Content-Type": "application/json" } })));
    const response = await searchFrus(query);
    expect(response.sourceRun.status).toBe("complete");
    expect(response.records[0]).toMatchObject({
      documentNumber: { value: "308" },
      officialUrl: { value: "https://history.state.gov/historicaldocuments/frus1981-88v05/d308" },
      provenance: { adapterId: "frus", officialDomain: "history.state.gov" }
    });
  });

  it("keeps the native CIA repository manual and separately registers NARA-held CIA records", () => {
    const cia = sourceRegistry.find((source) => source.id === "cia");
    expect(cia).toMatchObject({
      searchCapability: "manual",
      adapterStatus: "temporarily_unavailable",
      manualSearchLabel: "Retry CIA Reading Room"
    });
    expect(cia?.robotsAndTerms).toMatch(/disallows/i);
    expect(cia?.manualSearchUrl).toContain("cia.gov/readingroom");
    expect(cia?.officialAccessLinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "status",
          url: expect.stringContaining("cia.gov/redirects/search-unavailable")
        }),
        expect.objectContaining({
          kind: "fallback",
          url: expect.stringContaining("cia.gov/resources/publications")
        })
      ])
    );

    const naraCia = sourceRegistry.find((source) => source.id === "nara-cia-rg263");
    expect(naraCia).toMatchObject({
      searchCapability: "automated",
      adapterStatus: "beta",
      officialDomains: ["catalog.archives.gov", "archives.gov"]
    });
    expect(naraCia?.description).toMatch(/NARA Catalog records in Record Group 263/i);
    expect(naraCia?.knownLimitations.join(" ")).toMatch(/does not search the native CIA/i);
  });

  it("normalizes an exact JFK RIF from the official NARA release-file index", async () => {
    const officialUrl =
      "https://www.archives.gov/files/research/jfk/releases/2025/0318/104-10003-10041.pdf";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              sourceId: "nara-jfk-2025",
              sourcePage:
                "https://www.archives.gov/research/jfk/release-2025",
              limitations: [
                "The source-reported row date does not reliably identify the actual release batch."
              ],
              records: [
                {
                  id: "jfk-file-1",
                  fileName: "104-10003-10041.pdf",
                  rifNumber: "104-10003-10041",
                  fileVariant: "",
                  sourceReportedRowDate: "03/18/2025",
                  officialUrl,
                  recordPageUrl:
                    "https://www.archives.gov/research/jfk/release-2025",
                  searchableText:
                    "104-10003-10041 104-10003-10041.pdf",
                  releaseStatus: "not_determined",
                  releaseDeterminationBasis:
                    "The official listing does not provide a record-specific full-release determination."
                }
              ]
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" }
            }
          )
      )
    );
    const response = await searchJfk2025({
      target: {
        mode: "guided",
        identifiers: "104-10003-10041"
      },
      query: {
        id: "jfk-query",
        label: "Exact RIF",
        text: "104-10003-10041",
        kind: "identifier",
        enabled: true,
        sourceIds: ["nara-jfk-2025"],
        explanation: "fixture"
      },
      limit: 20,
      privateMode: false
    });
    expect(response.sourceRun).toMatchObject({
      sourceId: "nara-jfk-2025",
      status: "complete",
      resultCount: 1
    });
    expect(response.rawRecords).toHaveLength(1);
    expect(response.records[0]).toMatchObject({
      title: { value: "104-10003-10041.pdf" },
      documentNumber: { value: "104-10003-10041" },
      releaseStatus: {
        status: "not_determined",
        humanReview: true
      },
      officialUrl: { value: officialUrl },
      downloadUrl: { value: officialUrl },
      provenance: {
        adapterId: "nara-jfk-2025",
        sourceId: "nara-jfk-2025",
        officialDomain: "www.archives.gov"
      }
    });
    expect(response.records[0].date).toBeUndefined();
    expect(response.records[0].releaseDate).toBeUndefined();
    expect(response.records[0].textSnippet?.value).toContain(
      "only in the raw source record"
    );
    expect(response.records[0].digitalObjects[0]?.url).toBe(officialUrl);
    expect(JSON.stringify(response)).not.toMatch(
      /doctly\.|github\.com\/doctly/i
    );
  });
});
