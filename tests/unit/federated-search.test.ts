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
});
