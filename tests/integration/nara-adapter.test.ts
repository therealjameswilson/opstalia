import { afterEach, describe, expect, it, vi } from "vitest";
import naraResponse from "../fixtures/nara-response.json";
import {
  NARA_DISCOVERY_PROFILES,
  NaraAdapter
} from "../../worker/src/adapters/nara";
import type { NormalizedSearchQuery } from "../../src/core/types";

const query: NormalizedSearchQuery = {
  target: { mode: "quick", quickQuery: "NAID 1634221", identifiers: "NAID 1634221" },
  query: {
    id: "q1",
    label: "NAID",
    text: "1634221",
    kind: "identifier",
    enabled: true,
    sourceIds: ["nara"],
    explanation: "Exact identifier"
  },
  limit: 20,
  privateMode: false
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("NARA response normalization", () => {
  it("preserves provenance and does not infer full release from a digital object", () => {
    const hit = naraResponse.body.hits.hits[0];
    const adapter = new NaraAdapter({ NARA_API_KEY: "test-only-not-a-real-key" });
    const records = adapter.normalize(hit, query, {
      signal: new AbortController().signal,
      retrievedAt: "2026-07-29T00:00:00Z"
    });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      naraNaid: { value: "1634221" },
      releaseStatus: { status: "not_determined", humanReview: true },
      provenance: {
        adapterId: "nara",
        officialDomain: "catalog.archives.gov",
        officialRecordUrl: "https://catalog.archives.gov/id/1634221"
      }
    });
    expect(records[0].confidenceScore).toBeGreaterThan(30);
  });

  it("handles malformed optional OCR without unsafe HTML rendering", () => {
    const hit = structuredClone(naraResponse.body.hits.hits[0]) as any;
    hit._source.record.scopeAndContentNote = { unexpected: "<script>alert(1)</script>" };
    hit._source.record.digitalObjects[0].ocrText = { malformed: true };
    hit._source.record.digitalObjects[0].downloadUrl = "https://catalog.archives.gov.evil.example/payload.pdf";
    hit._source.record.digitalObjects[0].thumbnailUrl = "javascript:alert(1)";
    const adapter = new NaraAdapter({ NARA_API_KEY: "test-only-not-a-real-key" });
    const [record] = adapter.normalize(hit, query, {
      signal: new AbortController().signal,
      retrievedAt: "2026-07-29T00:00:00Z"
    });
    expect(record.digitalObjects).toEqual([]);
    expect(record.ocrAvailability).toMatchObject({ value: false });
  });

  it("normalizes the current production-date and digital-object field names", () => {
    const hit = structuredClone(naraResponse.body.hits.hits[0]) as any;
    delete hit._source.record.coverageStartDate;
    delete hit._source.record.coverageEndDate;
    hit._source.record.productionDates = [{ year: 1970, month: 1, day: 2, logicalDate: "1970-01-02" }];
    hit._source.record.generalRecordsTypes = ["Photographs and other Graphic Materials"];
    hit._source.record.digitalObjects[0].objectType = "Image (JPG)";
    hit._source.record.digitalObjects[0].objectFileSize = 12345;
    hit._source.record.digitalObjects[0].downloadUrl =
      "https://catalog.archives.gov/id/1634221.jpg";
    const adapter = new NaraAdapter({ NARA_API_KEY: "test-only-not-a-real-key" });
    const [record] = adapter.normalize(hit, query, {
      signal: new AbortController().signal,
      retrievedAt: "2026-07-29T00:00:00Z"
    });
    expect(record.date).toMatchObject({ value: "1970-01-02" });
    expect(record.subject).toMatchObject({ value: ["Photographs and other Graphic Materials"] });
    expect(record.digitalObjects[0]).toMatchObject({ mediaType: "Image (JPG)", sizeBytes: 12345 });
  });

  it("bounds returned digital-object metadata and OCR text", () => {
    const hit = structuredClone(naraResponse.body.hits.hits[0]) as any;
    hit._source.record.digitalObjects = Array.from({ length: 205 }, (_, index) => ({
      objectUrl: `https://catalog.archives.gov/id/1634221-${index}.pdf`,
      ocrText: "x".repeat(100_001)
    }));
    const adapter = new NaraAdapter({ NARA_API_KEY: "test-only-not-a-real-key" });
    const [record] = adapter.normalize(hit, query, {
      signal: new AbortController().signal,
      retrievedAt: "2026-07-29T00:00:00Z"
    });
    expect(record.digitalObjects).toHaveLength(200);
    expect(Math.max(...record.digitalObjects.map((object) => object.ocrText?.length ?? 0))).toBeLessThanOrEqual(100_000);
    expect(record.digitalObjects.reduce((sum, object) => sum + (object.ocrText?.length ?? 0), 0)).toBeLessThanOrEqual(500_000);
  });

  it("maps advanced identifier syntax to documented NARA v2 filters", async () => {
    let requestedUrl = "";
    let requestInit: RequestInit | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        requestedUrl = String(input);
        requestInit = init;
        return new Response(JSON.stringify(naraResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      })
    );
    const adapter = new NaraAdapter({ NARA_API_KEY: "test-only-not-a-real-key" });
    await adapter.search(
      {
        ...query,
        target: {
          mode: "guided",
          titleOrSubject: "Memorandum",
          documentType: "memorandum",
          identifiers: "RG 59; collection DDE-1021; ancestor NAID 75284; level file unit"
        },
        query: { ...query.query, text: "Memorandum", kind: "exact_phrase" }
      },
      { signal: new AbortController().signal, retrievedAt: "2026-07-29T00:00:00Z" }
    );
    const parameters = new URL(requestedUrl).searchParams;
    expect(parameters.get("recordGroupNumber")).toBe("59");
    expect(parameters.get("collectionIdentifier")).toBe("DDE-1021");
    expect(parameters.get("ancestorNaId")).toBe("75284");
    expect(parameters.get("levelOfDescription")).toBe("fileUnit");
    expect(parameters.get("typeOfMaterials")).toBe("Textual Records");
    expect(parameters.has("naId_is")).toBe(false);
    expect(requestInit?.redirect).toBe("error");
  });

  it.each([
    {
      profileId: "nara-cia-rg263",
      recordGroupNumber: "263",
      nativeName: "CIA FOIA Electronic Reading Room",
      manualUrl: "https://catalog.archives.gov/"
    },
    {
      profileId: "nara-state-rg59",
      recordGroupNumber: "59",
      nativeName: "Department of State FOIA Virtual Reading Room",
      manualUrl: "https://catalog.archives.gov/"
    }
  ] as const)(
    "constrains the $profileId profile to online NARA textual records without claiming native repository coverage",
    async ({ profileId, recordGroupNumber, nativeName, manualUrl }) => {
      let requestedUrl = "";
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request) => {
          requestedUrl = String(input);
          const scopedResponse = structuredClone(naraResponse) as any;
          scopedResponse.body.hits.hits[0]._source.record.ancestors.push({
            title: `Record Group ${recordGroupNumber}: profile fixture`,
            levelOfDescription: "recordGroup"
          });
          return new Response(JSON.stringify(scopedResponse), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        })
      );
      const adapter = new NaraAdapter(
        { NARA_API_KEY: "test-only-not-a-real-key" },
        NARA_DISCOVERY_PROFILES[profileId]
      );
      const response = await adapter.search(
        {
          ...query,
          target: {
            mode: "guided",
            titleOrSubject: "Malta memorandum",
            identifiers: "RG 999"
          },
          query: {
            ...query.query,
            text: "Malta memorandum",
            sourceIds: [profileId]
          }
        },
        { signal: new AbortController().signal, retrievedAt: "2026-07-29T00:00:00Z" }
      );

      const parameters = new URL(requestedUrl).searchParams;
      expect(parameters.get("recordGroupNumber")).toBe(recordGroupNumber);
      expect(parameters.get("availableOnline")).toBe("true");
      expect(parameters.get("typeOfMaterials")).toBe("Textual Records");
      expect(response.sourceRun).toMatchObject({
        sourceId: profileId,
        status: "complete",
        manualSearchUrl: manualUrl
      });
      expect(response.warnings.join(" ")).toContain(`does not search the native ${nativeName}`);
      expect(response.records[0]).toMatchObject({
        sourceRepository: {
          value: expect.stringContaining(`RG ${recordGroupNumber}`)
        },
        provenance: {
          adapterId: profileId,
          sourceId: profileId,
          officialDomain: "catalog.archives.gov",
          normalizationVersion: "1.0.0-nara-catalog-profile"
        }
      });
    }
  );

  it("keeps an RG-profile result generic when the returned hierarchy does not expose a record group", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(naraResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
    );
    const adapter = new NaraAdapter(
      { NARA_API_KEY: "test-only-not-a-real-key" },
      NARA_DISCOVERY_PROFILES["nara-cia-rg263"]
    );
    const response = await adapter.search(query, {
      signal: new AbortController().signal,
      retrievedAt: "2026-07-29T00:00:00Z"
    });
    expect(response.records[0].sourceRepository.value).toBe("National Archives Catalog");
    expect(response.sourceRun.message).toContain("labeled generic NARA");
    expect(response.warnings.join(" ")).toContain("not expose an explicit record-group number");
  });

  it("does not treat a record-group mention on a non-record-group ancestor as scope proof", async () => {
    const misleading = structuredClone(naraResponse) as any;
    misleading.body.hits.hits[0]._source.record.ancestors.push({
      title: "Series cross-reference to Record Group 263",
      recordGroupNumber: "263",
      levelOfDescription: "series"
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(misleading), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
    );
    const adapter = new NaraAdapter(
      { NARA_API_KEY: "test-only-not-a-real-key" },
      NARA_DISCOVERY_PROFILES["nara-cia-rg263"]
    );
    const response = await adapter.search(query, {
      signal: new AbortController().signal,
      retrievedAt: "2026-07-29T00:00:00Z"
    });

    expect(response.records).toHaveLength(1);
    expect(response.records[0].sourceRepository.value).toBe("National Archives Catalog");
    expect(response.sourceRun.message).toContain("labeled generic NARA");
  });

  it("rejects an RG-profile result when the returned hierarchy exposes a conflicting group", async () => {
    const conflicting = structuredClone(naraResponse) as any;
    conflicting.body.hits.hits[0]._source.record.ancestors.push({
      title: "Record Group 59: General Records of the Department of State",
      levelOfDescription: "recordGroup"
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(conflicting), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
    );
    const adapter = new NaraAdapter(
      { NARA_API_KEY: "test-only-not-a-real-key" },
      NARA_DISCOVERY_PROFILES["nara-cia-rg263"]
    );
    const response = await adapter.search(query, {
      signal: new AbortController().signal,
      retrievedAt: "2026-07-29T00:00:00Z"
    });
    expect(response.records).toEqual([]);
    expect(response.warnings.join(" ")).toContain("rejected because the returned hierarchy");
  });
});
