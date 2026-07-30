import { afterEach, describe, expect, it, vi } from "vitest";
import { sourceRegistry } from "../../src/data/registry";
import type {
  NormalizedRecord,
  SearchPlan,
  SourceSearchResponse
} from "../../src/core/types";

function ntrsRecord(): NormalizedRecord {
  const officialUrl = "https://ntrs.nasa.gov/citations/123456789";
  return {
    id: "ntrs-123456789",
    title: {
      value: "Official NASA technical report",
      source: "NASA NTRS",
      extractionMethod: "source_structured",
      confidence: 1
    },
    sourceRepository: {
      value: "NASA Technical Reports Server",
      source: "NASA NTRS",
      extractionMethod: "source_structured",
      confidence: 1
    },
    officialUrl: {
      value: officialUrl,
      source: "NASA NTRS",
      extractionMethod: "source_structured",
      confidence: 1
    },
    recordPageUrl: {
      value: officialUrl,
      source: "NASA NTRS",
      extractionMethod: "source_structured",
      confidence: 1
    },
    releaseStatus: {
      status: "not_determined",
      determinationBasis: "Public STI metadata does not establish a declassification determination.",
      source: "NASA NTRS",
      confidence: 0.4,
      humanReview: true
    },
    exemptionCodes: [],
    classificationMarkings: [],
    extractedIdentifiers: ["123456789"],
    digitalObjects: [],
    provenance: {
      adapterId: "nasa-ntrs",
      sourceId: "nasa-ntrs",
      officialDomain: "ntrs.nasa.gov",
      officialRecordUrl: officialUrl,
      retrievalTimestamp: "2026-07-29T00:00:00Z",
      normalizationVersion: "test"
    },
    retrievalTimestamp: "2026-07-29T00:00:00Z",
    confidenceScore: 80,
    matchExplanation: [],
    review: { disposition: "unreviewed" }
  };
}

function plan(sourceIds: string[]): SearchPlan {
  return {
    id: "plan-timeout",
    createdAt: "2026-07-29T00:00:00Z",
    target: { mode: "quick", quickQuery: "Apollo" },
    queries: [
      {
        id: "query-1",
        label: "First query",
        text: "Apollo",
        kind: "broad_keyword",
        enabled: true,
        sourceIds,
        explanation: "First explicit source query"
      },
      {
        id: "query-2",
        label: "Second query",
        text: "Lunar",
        kind: "broad_keyword",
        enabled: true,
        sourceIds,
        explanation: "Second explicit source query"
      }
    ],
    sourceSelectionStrategy: ["NASA NTRS"]
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("federated source orchestration", () => {
  it("preserves an earlier successful result when a later same-source query times out", async () => {
    vi.stubEnv("VITE_API_BASE", "https://opstalia-api.example");
    const source = sourceRegistry.find((entry) => entry.id === "nasa-ntrs")!;
    const successfulResponse: SourceSearchResponse = {
      sourceRun: {
        id: "source-run-1",
        sourceId: "nasa-ntrs",
        status: "complete",
        completedAt: "2026-07-29T00:00:00Z",
        resultCount: 1
      },
      rawRecords: [],
      records: [ntrsRecord()],
      warnings: []
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(successfulResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
      .mockImplementationOnce((_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () =>
              reject(
                init.signal?.reason ??
                  new DOMException("Source timeout", "TimeoutError")
              ),
            { once: true }
          );
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    const { runFederatedSearch } = await import("../../src/search/client");

    const result = await runFederatedSearch(
      plan(["nasa-ntrs"]),
      [source],
      false,
      vi.fn(),
      vi.fn(),
      undefined,
      10
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.records).toEqual([
      expect.objectContaining({ id: "ntrs-123456789" })
    ]);
    expect(result.sourceRuns[0]).toMatchObject({
      sourceId: "nasa-ntrs",
      status: "complete",
      resultCount: 1
    });
    expect(result.sourceRuns[0].message).toContain(
      "1 query failed without discarding these results"
    );
    expect(result.warnings.join(" ")).toContain("Source timeout");
  });

  it("does not silently send a query whose source target list is empty", async () => {
    vi.stubEnv("VITE_API_BASE", "https://opstalia-api.example");
    const source = sourceRegistry.find((entry) => entry.id === "nasa-ntrs")!;
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const { runFederatedSearch } = await import("../../src/search/client");

    const result = await runFederatedSearch(
      plan([]),
      [source],
      false,
      vi.fn(),
      vi.fn()
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.sourceRuns[0]).toMatchObject({
      sourceId: "nasa-ntrs",
      status: "no_results",
      message: "No enabled query in the plan targets this source."
    });
  });

  it("dispatches the opt-in NARA JFK source to its browser-local index adapter", async () => {
    const source = sourceRegistry.find(
      (entry) => entry.id === "nara-jfk-2025"
    )!;
    const officialUrl =
      "https://www.archives.gov/files/research/jfk/releases/2025/0318/104-10003-10041.pdf";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          sourceId: "nara-jfk-2025",
          sourcePage:
            "https://www.archives.gov/research/jfk/release-2025",
          limitations: [],
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
                "No record-specific full-release determination is present."
            }
          ]
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const { runFederatedSearch } = await import("../../src/search/client");
    const jfkPlan: SearchPlan = {
      id: "jfk-plan",
      createdAt: "2026-07-30T00:00:00Z",
      target: {
        mode: "guided",
        identifiers: "104-10003-10041"
      },
      queries: [
        {
          id: "jfk-query",
          label: "Exact RIF",
          text: "104-10003-10041",
          kind: "identifier",
          enabled: true,
          sourceIds: ["nara-jfk-2025"],
          explanation: "Exact official release filename identifier"
        }
      ],
      sourceSelectionStrategy: ["Official NARA JFK release index"]
    };
    const result = await runFederatedSearch(
      jfkPlan,
      [source],
      false,
      vi.fn(),
      vi.fn()
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "data/indexes/jfk-2025.json"
    );
    expect(result.sourceRuns[0]).toMatchObject({
      sourceId: "nara-jfk-2025",
      status: "complete",
      resultCount: 1
    });
    expect(result.records[0]).toMatchObject({
      documentNumber: { value: "104-10003-10041" },
      officialUrl: { value: officialUrl }
    });
  });
});
