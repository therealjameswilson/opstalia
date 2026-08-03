import { afterEach, describe, expect, it, vi } from "vitest";
import { sourceRegistry } from "../../src/data/registry";
import { buildManualSearchHandoff, manualQueryText } from "../../src/search/manual-handoff";
import { createManualOfficialRecord } from "../../src/search/manual-record";
import { runFederatedSearch } from "../../src/search/client";
import { buildSearchPlan } from "../../src/search/query-expansion";
import { isApprovedOfficialUrl } from "../../src/security/url-policy";

const state = sourceRegistry.find((source) => source.id === "state-foia")!;
const cia = sourceRegistry.find((source) => source.id === "cia")!;
const naraCia = sourceRegistry.find((source) => source.id === "nara-cia-rg263")!;
const epa = sourceRegistry.find((source) => source.id === "epa")!;
const govinfo = sourceRegistry.find((source) => source.id === "govinfo")!;

function unavailableWorkerResponse(sourceId: string, manualSearchUrl: string, warning: string): Response {
  return new Response(
    JSON.stringify({
      sourceRun: {
        id: `source-run-${sourceId}`,
        sourceId,
        status: "temporarily_unavailable",
        completedAt: "2026-08-03T00:00:00.000Z",
        resultCount: 0,
        message: "Simulated unavailable Worker response.",
        manualSearchUrl
      },
      rawRecords: [],
      records: [],
      warnings: [warning]
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("manual official-source handoffs", () => {
  it("prepares a query-aware State FOIA URL without transmitting research notes", () => {
    const plan = buildSearchPlan({
      mode: "guided",
      titleOrSubject: "Scowcroft memorandum",
      exactPhrase: "Malta Summit",
      generalKeywords: "arms control &inject=true?#fragment <script>",
      dateFrom: "1989-11-01",
      dateTo: "1990-01-31",
      authorSender: "Brent Scowcroft",
      recipient: "George H. W. Bush",
      documentType: "Memorandum",
      identifiers: "F-2020-12345",
      notes: "NEVER INCLUDE THIS RESEARCH NOTE"
    });

    const handoff = buildManualSearchHandoff(state, plan);
    const url = new URL(handoff.queryUrl!);

    expect(handoff.status).toBe("prepared");
    expect(url.origin).toBe("https://foia.state.gov");
    expect(url.pathname).toBe("/FOIALIBRARY/SearchResults.aspx");
    expect(isApprovedOfficialUrl(handoff.queryUrl!, state)).toBe(true);
    expect(handoff.queryUrl).toContain("searchText=%22Malta%20Summit%22");
    expect(handoff.queryUrl).not.toContain("+");
    expect(url.searchParams.get("beginDate")).toBe("11-01-1989");
    expect(url.searchParams.get("endDate")).toBe("01-31-1990");
    expect(url.searchParams.get("DocFrom")).toBe("Brent Scowcroft");
    expect(url.searchParams.get("DocTo")).toBe("George H. W. Bush");
    expect(url.searchParams.get("caseNumber")).toBe("F-2020-12345");
    expect(url.searchParams.get("ME")).toBe("true");
    expect(handoff.appliedFilters["Document type"]).toBe("Memorandum");

    expect(handoff.queryText).not.toContain("NEVER INCLUDE THIS RESEARCH NOTE");
    expect(handoff.queryUrl).not.toContain("NEVER%20INCLUDE");
    expect(handoff.queryUrl).not.toContain("&inject=true");
    expect(handoff.queryUrl).not.toContain("#fragment");
    expect(handoff.queryUrl).not.toContain("<script>");
    expect(url.searchParams.get("searchText")).not.toMatch(/[&=?#<>]/);
  });

  it("reports the upstream CIA Reading Room outage without making a network request", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const plan = buildSearchPlan({
      mode: "quick",
      quickQuery: "Malta Summit Scowcroft Bush"
    });

    const handoff = buildManualSearchHandoff(cia, plan);

    expect(handoff).toMatchObject({
      status: "unavailable",
      queryText: "Malta Summit Scowcroft Bush",
      queryUrl: cia.manualSearchUrl
    });
    expect(handoff.warnings.join(" ")).toMatch(/redirect loop/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("bounds every generated handoff query to the import schema limit", () => {
    const plan = buildSearchPlan({
      mode: "guided",
      titleOrSubject: "T".repeat(500),
      exactPhrase: "E".repeat(500),
      generalKeywords: "K".repeat(500),
      geographicFocus: "G".repeat(300)
    });

    expect(manualQueryText(plan)).toHaveLength(1000);
    expect(buildManualSearchHandoff(cia, plan).queryText).toHaveLength(1000);
  });

  it("uses the researcher-edited enabled plan instead of rebuilding hidden target terms", () => {
    const plan = buildSearchPlan({
      mode: "guided",
      titleOrSubject: "ORIGINAL TARGET TERM",
      exactPhrase: "ORIGINAL EXACT TERM",
      generalKeywords: "ORIGINAL KEYWORD"
    });
    plan.queries = plan.queries.map((query) => ({
      ...query,
      enabled: query.kind === "broad_keyword",
      text: query.kind === "broad_keyword" ? "RESEARCHER EDITED QUERY" : query.text
    }));

    const handoff = buildManualSearchHandoff(state, plan);
    expect(handoff.queryText).toBe("RESEARCHER EDITED QUERY");
    expect(handoff.queryUrl).toContain("searchText=RESEARCHER%20EDITED%20QUERY");
    expect(handoff.queryUrl).not.toContain("ORIGINAL");
  });

  it("does not carry removed date, identifier, name, or type queries into hidden source filters", () => {
    const plan = buildSearchPlan({
      mode: "guided",
      titleOrSubject: "Visible title",
      dateFrom: "1989-11-01",
      dateTo: "1990-01-31",
      authorSender: "Brent Scowcroft",
      recipient: "George H. W. Bush",
      documentType: "Memorandum",
      identifiers: "F-2020-12345"
    });
    plan.queries = plan.queries.map((query) => ({
      ...query,
      enabled: query.kind === "broad_keyword",
      text: query.kind === "broad_keyword" ? "Visible title only" : query.text
    }));

    const stateHandoff = buildManualSearchHandoff(state, plan);
    const stateUrl = new URL(stateHandoff.queryUrl!);
    expect([...stateUrl.searchParams.keys()]).toEqual(["searchText"]);
    expect(stateHandoff.appliedFilters).toEqual({ "Search text": "Visible title only" });

    const ciaHandoff = buildManualSearchHandoff(cia, plan);
    expect(ciaHandoff.appliedFilters).toEqual({});
  });

  it("keeps planned registry entries non-runnable and never manufactures a manual handoff", async () => {
    const plan = buildSearchPlan({
      mode: "quick",
      quickQuery: "Malta Summit Scowcroft Bush"
    });
    const result = await runFederatedSearch(plan, [epa], false, vi.fn(), vi.fn());

    expect(result.sourceRuns).toHaveLength(1);
    expect(result.sourceRuns[0]).toMatchObject({
      sourceId: "epa",
      status: "blocked",
      resultCount: 0
    });
    expect(result.sourceRuns[0].manualHandoff).toBeUndefined();
    expect(result.sourceRuns[0].manualSearchUrl).toBeUndefined();
  });

  it("runs the separate NARA CIA profile only after its source ID is added to the plan", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        unavailableWorkerResponse(
          naraCia.id,
          naraCia.manualSearchUrl,
          "This automated NARA profile does not search the native CIA FOIA Electronic Reading Room."
        ))
    );
    const plan = buildSearchPlan({
      mode: "quick",
      quickQuery: "Malta Summit Scowcroft Bush"
    });
    expect(plan.queries[0].sourceIds).toContain("nara");
    expect(plan.queries[0].sourceIds).not.toContain("nara-cia-rg263");
    plan.queries = plan.queries.map((query) => ({
      ...query,
      sourceIds: [...query.sourceIds, "nara-cia-rg263"]
    }));

    const result = await runFederatedSearch(plan, [naraCia], false, vi.fn(), vi.fn());

    expect(result.sourceRuns[0]).toMatchObject({
      sourceId: "nara-cia-rg263",
      status: "temporarily_unavailable",
      manualSearchUrl: "https://catalog.archives.gov/"
    });
    expect(result.sourceRuns[0].message).not.toMatch(/No enabled query/);
    expect(result.warnings.join(" ")).toMatch(/does not search the native CIA FOIA/i);
  });

  it("runs a selected documented remote API after its source ID is added to the plan", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        unavailableWorkerResponse(
          govinfo.id,
          govinfo.manualSearchUrl,
          "GovInfo search requires a server-side GOVINFO_API_KEY."
        ))
    );
    const plan = buildSearchPlan({
      mode: "quick",
      quickQuery: "Malta Summit"
    });
    expect(plan.queries.every((query) => !query.sourceIds.includes("govinfo"))).toBe(true);
    plan.queries = plan.queries.map((query) => ({
      ...query,
      sourceIds: [...query.sourceIds, "govinfo"]
    }));

    const result = await runFederatedSearch(plan, [govinfo], false, vi.fn(), vi.fn());

    expect(result.sourceRuns[0]).toMatchObject({
      sourceId: "govinfo",
      status: "temporarily_unavailable",
      resultCount: 0,
      manualSearchUrl: "https://www.govinfo.gov/app/search/advanced"
    });
    expect(result.sourceRuns[0].message).not.toMatch(/No enabled query/);
    expect(result.warnings.join(" ")).toMatch(/GOVINFO_API_KEY/);
  });

  it("does not transmit a query to an automated source removed from every query target", async () => {
    const plan = buildSearchPlan({
      mode: "quick",
      quickQuery: "Malta Summit"
    });
    const result = await runFederatedSearch(plan, [govinfo], false, vi.fn(), vi.fn());
    expect(result.sourceRuns[0]).toMatchObject({
      sourceId: "govinfo",
      status: "no_results",
      resultCount: 0,
      message: "No enabled query in the plan targets this source."
    });
  });
});

describe("researcher-recorded official locators", () => {
  it.each([
    {
      source: state,
      url: "https://foia.state.gov/DOCUMENTS/1-FY2012/F-2011-01588/DOC_0C17684682/C17684682.pdf",
      title: "Department of State released-document result",
      expectedDomain: "foia.state.gov"
    },
    {
      source: cia,
      url: "https://www.cia.gov/readingroom/document/cia-rdp90-00965r000100120004-5",
      title: "CIA Electronic Reading Room document",
      expectedDomain: "www.cia.gov"
    }
  ])("accepts an approved HTTPS locator from $source.id", ({ source, url, title, expectedDomain }) => {
    const record = createManualOfficialRecord(
      source,
      { mode: "quick", quickQuery: "Malta Summit" },
      {
        title,
        officialUrl: url,
        date: "1989-12-03",
        identifier: source.id === "state-foia" ? "F-2020-12345" : "CIA-RDP90-00965R000100120004-5",
        note: "Researcher verified the official locator."
      }
    );

    expect(record.title).toMatchObject({
      value: title,
      extractionMethod: "researcher_confirmed",
      confidence: 1
    });
    expect(record.officialUrl).toMatchObject({
      value: url,
      extractionMethod: "researcher_confirmed",
      confidence: 1
    });
    expect(record.provenance).toMatchObject({
      adapterId: source.id,
      sourceId: source.id,
      officialDomain: expectedDomain,
      officialRecordUrl: url,
      normalizationVersion: "1.0.1-researcher-locator"
    });
    expect(record.releaseStatus).toMatchObject({
      status: "not_determined",
      source: "researcher",
      humanReview: true
    });
    expect(record.review).toMatchObject({
      disposition: "unreviewed",
      notes: "Researcher verified the official locator."
    });
  });

  it.each([
    [state, "https://example.com/FOIALIBRARY/Results2.aspx"],
    [state, "http://foia.state.gov/FOIALIBRARY/Results2.aspx"],
    [state, "https://foia.state.gov:444/FOIALIBRARY/Results2.aspx"],
    [state, "https://foia.state.gov/FOIALIBRARY/SearchResults.aspx?searchText=Malta"],
    [cia, "https://cia.gov.evil.example/readingroom/document/1"],
    [cia, "http://www.cia.gov/readingroom/document/1"],
    [cia, "https://www.cia.gov/resources/publications/publications-list/"]
  ])("rejects an unofficial or non-HTTPS locator", (source, url) => {
    expect(() =>
      createManualOfficialRecord(
        source,
        { mode: "quick", quickQuery: "Malta Summit" },
        { title: "Rejected locator", officialUrl: url }
      )
    ).toThrow(/HTTPS URL.*approved|credentials|nonstandard port|direct State|Reading Room document/i);
  });
});
