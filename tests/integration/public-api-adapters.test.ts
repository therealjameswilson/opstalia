import { afterEach, describe, expect, it, vi } from "vitest";
import govInfoResponse from "../fixtures/govinfo-search-response.json";
import ntrsResponse from "../fixtures/ntrs-search-response.json";
import ostiResponse from "../fixtures/osti-search-response.json";
import type { NormalizedSearchQuery } from "../../src/core/types";
import { GovInfoAdapter } from "../../worker/src/adapters/govinfo";
import { NtrsAdapter } from "../../worker/src/adapters/ntrs";
import { OstiAdapter } from "../../worker/src/adapters/osti";

const retrievedAt = "2026-07-30T02:42:30Z";

function query(sourceId: string, overrides: Partial<NormalizedSearchQuery> = {}): NormalizedSearchQuery {
  return {
    target: {
      mode: "guided",
      titleOrSubject: "Apollo",
      authorSender: "Williams",
      identifiers: "GSFC-E-DAA-TN59814",
      dateFrom: "2018-01-01",
      dateTo: "2019-12-31"
    },
    query: {
      id: "query-public-api",
      label: "Apollo",
      text: "Apollo",
      kind: "broad_keyword",
      enabled: true,
      sourceIds: [sourceId],
      explanation: "Recorded official-API fixture"
    },
    limit: 20,
    privateMode: true,
    ...overrides
  };
}

function context() {
  return {
    signal: new AbortController().signal,
    retrievedAt
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GovInfo Search Service adapter", () => {
  it("normalizes a recorded granule result and retains its public PDF", () => {
    const adapter = new GovInfoAdapter({ GOVINFO_API_KEY: "test-only-not-a-real-key" });
    const [record] = adapter.normalize(govInfoResponse.results[0], query("govinfo"), context());

    expect(record).toMatchObject({
      title: {
        value: "Allocation of Assets in Single-Employer Plans; Interest Assumptions for Valuing Benefits"
      },
      date: { value: "2026-07-29" },
      sourceCollection: { value: "FR" },
      originatingAgency: {
        value: "National Archives and Records Administration; Office of the Federal Register"
      },
      officialUrl: {
        value: "https://www.govinfo.gov/app/details/FR-2026-07-29/C1-2026-13124"
      },
      downloadUrl: {
        value: "https://www.govinfo.gov/content/pkg/FR-2026-07-29/pdf/C1-2026-13124.pdf"
      },
      releaseStatus: { status: "not_determined", humanReview: true },
      provenance: {
        adapterId: "govinfo",
        sourceId: "govinfo",
        officialDomain: "www.govinfo.gov"
      }
    });
    expect(record.digitalObjects).toEqual([
      expect.objectContaining({
        url: "https://www.govinfo.gov/content/pkg/FR-2026-07-29/pdf/C1-2026-13124.pdf",
        mediaType: "application/pdf"
      })
    ]);
  });

  it("uses the fixed documented endpoint, POST schema, and no-cache request", async () => {
    let requestedUrl = "";
    let requestedInit: (RequestInit & { cf?: { cacheTtl: number; cacheEverything: boolean } }) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        requestedUrl = String(input);
        requestedInit = init;
        return new Response(JSON.stringify(govInfoResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      })
    );

    const response = await new GovInfoAdapter({
      GOVINFO_API_KEY: "test-only-not-a-real-key"
    }).search(query("govinfo"), context());

    const url = new URL(requestedUrl);
    expect(`${url.origin}${url.pathname}`).toBe("https://api.govinfo.gov/search");
    expect(url.searchParams.get("api_key")).toBe("test-only-not-a-real-key");
    expect(JSON.parse(String(requestedInit?.body))).toEqual({
      query: "Apollo",
      pageSize: 20,
      offsetMark: "*",
      sorts: [{ field: "score", sortOrder: "DESC" }]
    });
    expect(String(requestedInit?.body)).not.toContain("test-only-not-a-real-key");
    expect(requestedInit).toMatchObject({
      method: "POST",
      redirect: "error",
      cf: { cacheTtl: 0, cacheEverything: false }
    });
    expect(response.sourceRun).toMatchObject({ status: "complete", resultCount: 1 });
  });

  it("isolates a missing key without making an outbound request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await new GovInfoAdapter({}).search(query("govinfo"), context());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      sourceRun: {
        sourceId: "govinfo",
        status: "temporarily_unavailable",
        resultCount: 0
      },
      records: []
    });
    expect(JSON.stringify(response)).not.toContain("undefined");
  });

  it("rejects an off-domain or mismatched API download locator", () => {
    const fixture = govInfoResponse.results[0];
    const candidates = [
      "https://api.govinfo.gov.evil.example/packages/FR-2026-07-29/granules/C1-2026-13124/pdf",
      "https://api.govinfo.gov/packages/OTHER-PACKAGE/granules/C1-2026-13124/pdf"
    ];

    for (const pdfLink of candidates) {
      const raw = structuredClone(fixture);
      raw.download.pdfLink = pdfLink;
      const [record] = new GovInfoAdapter({
        GOVINFO_API_KEY: "test-only-not-a-real-key"
      }).normalize(raw, query("govinfo"), context());

      expect(record.digitalObjects).toEqual([]);
      expect(record.downloadUrl).toBeUndefined();
      expect(record.releaseStatus.status).toBe("metadata_only");
    }
  });
});

describe("NASA Technical Reports Server adapter", () => {
  it("normalizes the recorded nested publication date and both public download representations", () => {
    const adapter = new NtrsAdapter();
    const [record] = adapter.normalize(ntrsResponse.results[0], query("nasa-ntrs"), context());

    expect(record).toMatchObject({
      title: { value: "Recent Findings from Restored Apollo Magnetic Field Records" },
      date: { value: "2018-12-10" },
      authorSender: { value: ["Chi, P. J.", "Russell, C. T.", "Williams, D. R."] },
      documentType: { value: "Abstract" },
      subject: { value: ["Lunar And Planetary Science And Exploration"] },
      officialUrl: { value: "https://ntrs.nasa.gov/citations/20180008545" },
      releaseStatus: { status: "not_determined", humanReview: true },
      ocrAvailability: { value: true },
      provenance: {
        adapterId: "nasa-ntrs",
        sourceId: "nasa-ntrs",
        officialDomain: "ntrs.nasa.gov"
      }
    });
    expect(record.digitalObjects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: "https://ntrs.nasa.gov/api/citations/20180008545/downloads/20180008545.pdf",
          mediaType: "application/pdf"
        }),
        expect.objectContaining({
          url: "https://ntrs.nasa.gov/api/citations/20180008545/downloads/20180008545.txt",
          mediaType: "text/plain"
        })
      ])
    );
  });

  it("maps supported filters to the fixed API host and disables caching in private mode", async () => {
    let requestedUrl = "";
    let requestedInit: (RequestInit & { cf?: { cacheTtl: number; cacheEverything: boolean } }) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        requestedUrl = String(input);
        requestedInit = init;
        return new Response(JSON.stringify(ntrsResponse), {
          status: 200,
          headers: { "Content-Type": "application/json; charset=utf-8" }
        });
      })
    );

    const response = await new NtrsAdapter().search(
      query("nasa-ntrs", { limit: 99, cursor: "10" }),
      context()
    );

    const url = new URL(requestedUrl);
    expect(`${url.origin}${url.pathname}`).toBe("https://ntrs.nasa.gov/api/citations/search");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      q: "Apollo",
      "page.size": "50",
      "page.from": "10",
      title: "Apollo",
      author: "Williams",
      reportNumber: "GSFC-E-DAA-TN59814",
      "published.at": "2018-01-01"
    });
    expect(requestedInit).toMatchObject({
      redirect: "error",
      cf: { cacheTtl: 0, cacheEverything: false }
    });
    expect(response.sourceRun).toMatchObject({ status: "complete", resultCount: 1 });
  });

  it("rejects off-domain download candidates while retaining a valid official text object", () => {
    const raw = structuredClone(ntrsResponse.results[0]);
    raw.downloads[0].links.pdf = "https://evil.example/document.pdf";
    raw.downloads[0].links.original = "//evil.example/document.pdf";

    const [record] = new NtrsAdapter().normalize(raw, query("nasa-ntrs"), context());

    expect(record.digitalObjects).toEqual([
      expect.objectContaining({
        url: "https://ntrs.nasa.gov/api/citations/20180008545/downloads/20180008545.txt",
        mediaType: "text/plain"
      })
    ]);
    expect(record.digitalObjects.some((object) => object.url.includes("evil.example"))).toBe(false);
    expect(record.releaseStatus.status).toBe("not_determined");
  });

  it("rejects an official-host download path bound to a different citation ID", () => {
    const raw = structuredClone(ntrsResponse.results[0]);
    raw.downloads[0].links = {
      pdf: "/api/citations/99999999/downloads/20180008545.pdf",
      original: "/api/citations/99999999/downloads/20180008545.pdf",
      fulltext: "/api/citations/99999999/downloads/20180008545.txt"
    };
    const [record] = new NtrsAdapter().normalize(raw, query("nasa-ntrs"), context());
    expect(record.digitalObjects).toEqual([]);
    expect(record.releaseStatus.status).toBe("metadata_only");
  });

  it("rejects encoded separators, backslashes, dot segments, and malformed escapes in download filenames", () => {
    const candidates = [
      "/api/citations/20180008545/downloads/%2F..%2Fother.pdf",
      "/api/citations/20180008545/downloads/%5C..%5Cother.pdf",
      "/api/citations/20180008545/downloads/%2e%2e",
      "/api/citations/20180008545/downloads/%252Fdouble-encoded.pdf",
      "/api/citations/20180008545/downloads/malformed%.pdf"
    ];
    for (const candidate of candidates) {
      const raw = structuredClone(ntrsResponse.results[0]);
      raw.downloads[0].links = {
        pdf: candidate,
        original: candidate,
        fulltext: candidate
      };
      const [record] = new NtrsAdapter().normalize(
        raw,
        query("nasa-ntrs"),
        context()
      );
      expect(record.digitalObjects, candidate).toEqual([]);
      expect(record.releaseStatus.status, candidate).toBe("metadata_only");
    }
  });
});

describe("OSTI.GOV public API adapter", () => {
  it("normalizes a recorded public citation without promoting it to a full release", () => {
    const adapter = new OstiAdapter();
    const [record] = adapter.normalize(ostiResponse[0], query("osti-sti"), context());

    expect(record).toMatchObject({
      title: { value: "Trivalent titanium in high-titanium lunar ilmenite" },
      date: { value: "2026-03-27" },
      originatingAgency: {
        value: expect.stringContaining("National Aeronautics and Space Administration (NASA)")
      },
      office: {
        value: "Lawrence Berkeley National Laboratory (LBNL), Berkeley, CA (United States)"
      },
      documentType: { value: "Journal Article" },
      subject: { value: ["mineralogy", "petrology"] },
      officialUrl: { value: "https://www.osti.gov/biblio/3363743" },
      downloadUrl: { value: "https://www.osti.gov/servlets/purl/3363743" },
      releaseStatus: { status: "not_determined", humanReview: true },
      provenance: {
        adapterId: "osti-sti",
        sourceId: "osti-sti",
        officialDomain: "www.osti.gov"
      }
    });
    expect(record.digitalObjects).toEqual([
      expect.objectContaining({
        url: "https://www.osti.gov/servlets/purl/3363743"
      })
    ]);
  });

  it("maps supported filters to the fixed API host and translates a rate limit", async () => {
    let requestedUrl = "";
    let requestedInit: (RequestInit & { cf?: { cacheTtl: number; cacheEverything: boolean } }) | undefined;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async (input: string | URL | Request, init?: RequestInit) => {
        requestedUrl = String(input);
        requestedInit = init;
        return new Response(JSON.stringify(ostiResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      })
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new OstiAdapter();
    const response = await adapter.search(query("osti-sti", { limit: 99, cursor: "2" }), context());

    const url = new URL(requestedUrl);
    expect(`${url.origin}${url.pathname}`).toBe("https://www.osti.gov/api/v1/records");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      q: "Apollo",
      rows: "50",
      page: "2",
      title: "Apollo",
      author: "Williams",
      identifier: "GSFC-E-DAA-TN59814",
      publication_date_start: "2018-01-01",
      publication_date_end: "2019-12-31"
    });
    expect(requestedInit).toMatchObject({
      redirect: "error",
      cf: { cacheTtl: 0, cacheEverything: false }
    });
    expect(response.sourceRun).toMatchObject({ status: "complete", resultCount: 1 });
    await expect(adapter.search(query("osti-sti"), context())).rejects.toThrow(
      "OSTI.GOV rate limit reached (429)"
    );
  });

  it("rejects a citation record whose only locator is off the approved official host", () => {
    const raw = structuredClone(ostiResponse[0]);
    raw.links = [{ rel: "citation", href: "https://osti.gov.evil.example/biblio/3363743" }];

    expect(new OstiAdapter().normalize(raw, query("osti-sti"), context())).toEqual([]);
  });

  it("rejects official-host citation and full-text paths bound to another OSTI ID", () => {
    const raw = structuredClone(ostiResponse[0]);
    raw.links = [
      { rel: "citation", href: "https://www.osti.gov/biblio/9999999" },
      { rel: "fulltext", href: "https://www.osti.gov/servlets/purl/9999999" }
    ];
    expect(new OstiAdapter().normalize(raw, query("osti-sti"), context())).toEqual([]);

    const citationOnly = structuredClone(ostiResponse[0]);
    citationOnly.links = [
      { rel: "citation", href: "https://www.osti.gov/biblio/3363743" },
      { rel: "fulltext", href: "https://www.osti.gov/servlets/purl/9999999" }
    ];
    const [record] = new OstiAdapter().normalize(citationOnly, query("osti-sti"), context());
    expect(record.digitalObjects).toEqual([]);
    expect(record.releaseStatus.status).toBe("metadata_only");
  });
});
