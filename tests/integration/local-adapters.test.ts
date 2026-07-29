import { afterEach, describe, expect, it, vi } from "vitest";
import frusIndex from "../fixtures/frus-index.json";
import { searchFrus } from "../../src/search/local-adapters";
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

  it("returns an honest manual CIA adapter policy rather than a scraper", () => {
    const cia = sourceRegistry.find((source) => source.id === "cia");
    expect(cia).toMatchObject({
      searchCapability: "manual",
      adapterStatus: "temporarily_unavailable"
    });
    expect(cia?.robotsAndTerms).toMatch(/disallows/i);
    expect(cia?.manualSearchUrl).toContain("cia.gov/readingroom");
  });
});
