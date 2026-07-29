import { afterEach, describe, expect, it, vi } from "vitest";
import naraResponse from "../fixtures/nara-response.json";
import { NaraAdapter } from "../../worker/src/adapters/nara";
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
    expect(record.digitalObjects[0]).toMatchObject({
      url: "https://catalog.archives.gov/id/1634221"
    });
    expect(record.digitalObjects[0].downloadUrl).toBeUndefined();
    expect(record.digitalObjects[0].thumbnailUrl).toBeUndefined();
  });

  it("normalizes the current production-date and digital-object field names", () => {
    const hit = structuredClone(naraResponse.body.hits.hits[0]) as any;
    delete hit._source.record.coverageStartDate;
    delete hit._source.record.coverageEndDate;
    hit._source.record.productionDates = [{ year: 1970, month: 1, day: 2, logicalDate: "1970-01-02" }];
    hit._source.record.generalRecordsTypes = ["Photographs and other Graphic Materials"];
    hit._source.record.digitalObjects[0].objectType = "Image (JPG)";
    hit._source.record.digitalObjects[0].objectFileSize = 12345;
    const adapter = new NaraAdapter({ NARA_API_KEY: "test-only-not-a-real-key" });
    const [record] = adapter.normalize(hit, query, {
      signal: new AbortController().signal,
      retrievedAt: "2026-07-29T00:00:00Z"
    });
    expect(record.date).toMatchObject({ value: "1970-01-02" });
    expect(record.subject).toMatchObject({ value: ["Photographs and other Graphic Materials"] });
    expect(record.digitalObjects[0]).toMatchObject({ mediaType: "Image (JPG)", sizeBytes: 12345 });
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
});
