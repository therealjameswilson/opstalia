import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../../worker/src/index";
import ntrsResponse from "../fixtures/ntrs-search-response.json";

const validBody = {
  target: { mode: "quick", quickQuery: "NAID 1634221" },
  query: {
    id: "q1",
    label: "NAID",
    text: "1634221",
    kind: "identifier",
    enabled: true,
    sourceIds: ["nara"],
    explanation: "Exact"
  },
  limit: 20,
  privateMode: false
};

function request(ip: string, origin = "https://therealjameswilson.github.io") {
  return new Request("https://opstalia-api.example/api/search/nara", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, "CF-Connecting-IP": ip },
    body: JSON.stringify(validBody)
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Worker request boundary", () => {
  it("reports secret readiness without returning a secret value", async () => {
    const response = await worker.fetch(
      new Request("https://opstalia-api.example/api/health", { headers: { Origin: "https://therealjameswilson.github.io" } }),
      { NARA_API_KEY: "test-only-do-not-return-this-value", APP_ENV: "production" }
    );
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).toContain('"naraSecretConfigured":true');
    expect(text).not.toContain("test-only-do-not-return-this-value");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });

  it("enforces exact-origin CORS", async () => {
    const response = await worker.fetch(request("198.51.100.1", "https://evil.example"), { APP_ENV: "production" });
    expect(response.status).toBe(403);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("rate limits without logging or persisting the address", async () => {
    let latest: Response | undefined;
    for (let index = 0; index < 31; index += 1) {
      latest = await worker.fetch(request("198.51.100.77"), { APP_ENV: "production", RATE_LIMIT_SALT: "test-salt" });
    }
    expect(latest?.status).toBe(429);
  });

  it("rejects malformed bodies and isolates the missing-secret source state", async () => {
    const missingSecret = await worker.fetch(request("198.51.100.2"), { APP_ENV: "production" });
    expect(missingSecret.status).toBe(200);
    expect(await missingSecret.json()).toMatchObject({ sourceRun: { status: "temporarily_unavailable" } });
    const malformed = await worker.fetch(
      new Request("https://opstalia-api.example/api/search/nara", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://therealjameswilson.github.io", "CF-Connecting-IP": "198.51.100.3" },
        body: '{"invalid":true}'
      }),
      { APP_ENV: "production" }
    );
    expect(malformed.status).toBe(400);

    const invalidJson = await worker.fetch(
      new Request("https://opstalia-api.example/api/search/nara", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://therealjameswilson.github.io",
          "CF-Connecting-IP": "198.51.100.31"
        },
        body: "{"
      }),
      { APP_ENV: "production" }
    );
    expect(invalidJson.status).toBe(400);

    const wrongContentType = await worker.fetch(
      new Request("https://opstalia-api.example/api/search/nara", {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          Origin: "https://therealjameswilson.github.io",
          "CF-Connecting-IP": "198.51.100.32"
        },
        body: JSON.stringify(validBody)
      }),
      { APP_ENV: "production" }
    );
    expect(wrongContentType.status).toBe(400);
  });

  it.each([
    ["nara-cia-rg263", "198.51.100.4"],
    ["nara-state-rg59", "198.51.100.5"]
  ])("routes the separate %s NARA profile without changing a native repository adapter", async (sourceId, ip) => {
    const response = await worker.fetch(
      new Request(`https://opstalia-api.example/api/search/${sourceId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://therealjameswilson.github.io",
          "CF-Connecting-IP": ip
        },
        body: JSON.stringify({
          ...validBody,
          query: { ...validBody.query, sourceIds: [sourceId] }
        })
      }),
      { APP_ENV: "production" }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      sourceRun: {
        sourceId,
        status: "temporarily_unavailable",
        manualSearchUrl: "https://catalog.archives.gov/"
      }
    });
    expect(body.warnings).toEqual(expect.arrayContaining([
        expect.stringContaining("NARA_API_KEY"),
        expect.stringContaining("does not search the native")
    ]));
  });

  it("reports GovInfo readiness without returning either secret", async () => {
    const response = await worker.fetch(
      new Request("https://opstalia-api.example/api/health", {
        headers: { Origin: "https://therealjameswilson.github.io" }
      }),
      {
        NARA_API_KEY: "test-only-nara-do-not-return",
        GOVINFO_API_KEY: "test-only-govinfo-do-not-return",
        APP_ENV: "production"
      }
    );
    const body = await response.json() as {
      govInfoSecretConfigured: boolean;
      ready: boolean;
      registeredAdapters: string[];
    };
    const text = JSON.stringify(body);
    expect(body.govInfoSecretConfigured).toBe(true);
    expect(body.ready).toBe(true);
    expect(body.registeredAdapters).toEqual([
      "nara",
      "nara-cia-rg263",
      "nara-state-rg59",
      "govinfo",
      "nasa-ntrs",
      "osti-sti"
    ]);
    expect(text).not.toContain("test-only-nara-do-not-return");
    expect(text).not.toContain("test-only-govinfo-do-not-return");
  });

  it("routes a documented no-secret public adapter and rejects unregistered routes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(ntrsResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
    );
    const body = {
      ...validBody,
      query: { ...validBody.query, sourceIds: ["nasa-ntrs"] }
    };
    const response = await worker.fetch(
      new Request("https://opstalia-api.example/api/search/nasa-ntrs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://therealjameswilson.github.io",
          "CF-Connecting-IP": "198.51.100.6"
        },
        body: JSON.stringify(body)
      }),
      { APP_ENV: "production" }
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      sourceRun: { sourceId: "nasa-ntrs", status: "complete", resultCount: 1 }
    });

    const rejected = await worker.fetch(
      new Request("https://opstalia-api.example/api/search/cia", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://therealjameswilson.github.io",
          "CF-Connecting-IP": "198.51.100.7"
        },
        body: JSON.stringify(validBody)
      }),
      { APP_ENV: "production" }
    );
    expect(rejected.status).toBe(404);
  });
});

describe("Worker presidential-library PDF relay", () => {
  const OFFICIAL_CHECKSUM = "a".repeat(64);
  const CHANGED_CHECKSUM = "b".repeat(64);
  const environment = {
    APP_ENV: "production",
    RATE_LIMIT_SALT: "test-only-pdf-relay-placeholder"
  };
  const body = {
    sourceId: "presidential-libraries",
    naraNaid: "470761856",
    officialRecordUrl: "https://catalog.archives.gov/id/470761856",
    officialPdfUrl: "https://catalog.archives.gov/medialz/presidential-libraries/bush/gb-nsc/example.pdf",
    acknowledgedPublicUnclassified: true
  };

  function sessionRequest(ip: string, override: Partial<typeof body> = {}) {
    return new Request("https://opstalia-api.example/api/pdf/session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://therealjameswilson.github.io",
        "CF-Connecting-IP": ip
      },
      body: JSON.stringify({ ...body, ...override })
    });
  }

  function stubOfficialPdf(options: {
    getIncludesLength?: boolean;
    getEtags?: Array<string | null>;
    getChecksums?: Array<string | null>;
    getLastModifieds?: Array<string | null>;
    getLengths?: Array<number | null>;
    getBodyLength?: number;
  } = {}) {
    const {
      getIncludesLength = true,
      getEtags = ["official-etag"],
      getChecksums = [OFFICIAL_CHECKSUM],
      getLastModifieds = ["Mon, 03 Aug 2026 00:00:00 GMT"],
      getLengths,
      getBodyLength = 1000
    } = options;
    let getIndex = 0;
    const mock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "HEAD") {
        throw new Error("The PDF relay should not depend on a method-specific HEAD response.");
      }
      const full = new Uint8Array(getBodyLength);
      full.set(new TextEncoder().encode("%PDF-"));
      const etag = getEtags[Math.min(getIndex, getEtags.length - 1)];
      const checksum = getChecksums[Math.min(getIndex, getChecksums.length - 1)];
      const lastModified = getLastModifieds[Math.min(getIndex, getLastModifieds.length - 1)];
      const declaredLength = getLengths?.[Math.min(getIndex, getLengths.length - 1)];
      getIndex += 1;
      const responseHeaders = new Headers({ "Content-Type": "application/pdf" });
      if (etag) responseHeaders.set("ETag", etag);
      if (checksum) responseHeaders.set("X-Amz-Meta-Checksum-Sha256", checksum);
      if (lastModified) responseHeaders.set("Last-Modified", lastModified);
      if (declaredLength !== null && (declaredLength !== undefined || getIncludesLength)) {
        responseHeaders.set("Content-Length", String(declaredLength ?? 1000));
      }
      return new Response(full, {
        status: 200,
        headers: responseHeaders
      });
    });
    vi.stubGlobal("fetch", mock);
    return mock;
  }

  it("requires the signing secret without exposing it", async () => {
    const response = await worker.fetch(sessionRequest("198.51.100.81"), { APP_ENV: "production" });
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).toContain("PDF_RELAY_NOT_READY");
    expect(text).not.toContain(environment.RATE_LIMIT_SALT);
  });

  it("streams under the fixed ceiling when Worker subrequests omit Content-Length", async () => {
    stubOfficialPdf({ getIncludesLength: false });
    const response = await worker.fetch(sessionRequest("198.51.100.92"), environment);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      byteLength: null,
      maxByteLength: 100 * 1024 * 1024,
      acceptRanges: false,
      deliveryMode: "bounded_full_file"
    });
  });

  it("issues a short-lived token, full-streams one bounded browser view, and exposes only safe headers", async () => {
    const fetchMock = stubOfficialPdf();
    const sessionResponse = await worker.fetch(sessionRequest("198.51.100.82"), environment);
    expect(sessionResponse.status).toBe(200);
    const session = await sessionResponse.json() as {
      contentUrl: string;
      byteLength: number | null;
      maxByteLength: number;
      acceptRanges: boolean;
      deliveryMode: string;
      etag: string;
    };
    expect(session).toMatchObject({
      byteLength: 1000,
      maxByteLength: 100 * 1024 * 1024,
      acceptRanges: false,
      deliveryMode: "bounded_full_file",
      etag: "official-etag"
    });
    expect(session.contentUrl).toMatch(/^\/api\/pdf\/content\?token=/);
    expect(session.contentUrl).not.toContain(body.officialPdfUrl);

    const contentResponse = await worker.fetch(
      new Request(`https://opstalia-api.example${session.contentUrl}`, {
        headers: {
          Origin: "https://therealjameswilson.github.io",
          "CF-Connecting-IP": "198.51.100.83",
          "X-Opstalia-Packet-View": "1"
        }
      }),
      environment
    );
    expect(contentResponse.status).toBe(200);
    expect(contentResponse.headers.get("Content-Range")).toBeNull();
    expect(contentResponse.headers.get("Content-Length")).toBeNull();
    expect(contentResponse.headers.get("Accept-Ranges")).toBe("none");
    expect(contentResponse.headers.get("Cache-Control")).toContain("no-store");
    expect(contentResponse.headers.get("Access-Control-Expose-Headers")).toContain("Content-Range");
    expect(contentResponse.headers.get("Set-Cookie")).toBeNull();
    const bytes = new Uint8Array(await contentResponse.arrayBuffer());
    expect(bytes.byteLength).toBe(1000);
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");
    for (const [input, init] of fetchMock.mock.calls) {
      expect(String(input)).toBe(body.officialPdfUrl);
      expect(new Headers(init?.headers).get("Accept-Encoding")).toBe("identity");
      expect(new Headers(init?.headers).has("Range")).toBe(false);
    }
  });

  it("uses the signature GET as the authoritative representation and never depends on HEAD", async () => {
    const fetchMock = stubOfficialPdf({
      getEtags: ["signature-get-etag", "signature-get-etag"],
      getChecksums: [null, null]
    });
    const sessionResponse = await worker.fetch(sessionRequest("198.51.100.95"), environment);
    expect(sessionResponse.status).toBe(200);
    const session = await sessionResponse.json() as { contentUrl: string; byteLength: number; etag: string };
    expect(session).toMatchObject({ byteLength: 1000, etag: "signature-get-etag" });

    const contentResponse = await worker.fetch(
      new Request(`https://opstalia-api.example${session.contentUrl}`, {
        headers: {
          Origin: "https://therealjameswilson.github.io",
          "CF-Connecting-IP": "198.51.100.96",
          "X-Opstalia-Packet-View": "1"
        }
      }),
      environment
    );
    expect(contentResponse.status).toBe(200);
    expect((await contentResponse.arrayBuffer()).byteLength).toBe(1000);
    expect(fetchMock.mock.calls.every(([, init]) => init?.method !== "HEAD")).toBe(true);
  });

  it("prefers the official object checksum when CDN ETags vary between GETs", async () => {
    stubOfficialPdf({
      getEtags: ["signature-get-etag", "relay-get-etag"],
      getChecksums: [OFFICIAL_CHECKSUM, OFFICIAL_CHECKSUM]
    });
    const sessionResponse = await worker.fetch(sessionRequest("198.51.100.97"), environment);
    const session = await sessionResponse.json() as { contentUrl: string };
    const contentResponse = await worker.fetch(
      new Request(`https://opstalia-api.example${session.contentUrl}`, {
        headers: {
          Origin: "https://therealjameswilson.github.io",
          "CF-Connecting-IP": "198.51.100.98",
          "X-Opstalia-Packet-View": "1"
        }
      }),
      environment
    );
    expect(contentResponse.status).toBe(200);
    expect(contentResponse.headers.get("ETag")).toBe("relay-get-etag");
    expect((await contentResponse.arrayBuffer()).byteLength).toBe(1000);
  });

  it("rejects a changed official object checksum before streaming", async () => {
    stubOfficialPdf({
      getChecksums: [OFFICIAL_CHECKSUM, CHANGED_CHECKSUM]
    });
    const sessionResponse = await worker.fetch(sessionRequest("198.51.100.99"), environment);
    const session = await sessionResponse.json() as { contentUrl: string };
    const contentResponse = await worker.fetch(
      new Request(`https://opstalia-api.example${session.contentUrl}`, {
        headers: {
          Origin: "https://therealjameswilson.github.io",
          "CF-Connecting-IP": "198.51.100.100",
          "X-Opstalia-Packet-View": "1"
        }
      }),
      environment
    );
    expect(contentResponse.status).toBe(409);
    expect(await contentResponse.text()).toContain("PDF_SOURCE_CHANGED");
  });

  it("falls back to a stable ETag when object-checksum metadata disappears", async () => {
    stubOfficialPdf({
      getChecksums: [OFFICIAL_CHECKSUM, null]
    });
    const sessionResponse = await worker.fetch(sessionRequest("198.51.100.107"), environment);
    const session = await sessionResponse.json() as { contentUrl: string };
    const contentResponse = await worker.fetch(
      new Request(`https://opstalia-api.example${session.contentUrl}`, {
        headers: {
          Origin: "https://therealjameswilson.github.io",
          "CF-Connecting-IP": "198.51.100.108",
          "X-Opstalia-Packet-View": "1"
        }
      }),
      environment
    );
    expect(contentResponse.status).toBe(200);
    expect((await contentResponse.arrayBuffer()).byteLength).toBe(1000);
  });

  it("remains bounded when the official GETs expose no representation validators or length", async () => {
    stubOfficialPdf({
      getIncludesLength: false,
      getEtags: [null, null],
      getChecksums: [null, null],
      getLastModifieds: [null, null]
    });
    const sessionResponse = await worker.fetch(sessionRequest("198.51.100.109"), environment);
    const session = await sessionResponse.json() as { contentUrl: string; byteLength: null };
    expect(session.byteLength).toBeNull();
    const contentResponse = await worker.fetch(
      new Request(`https://opstalia-api.example${session.contentUrl}`, {
        headers: {
          Origin: "https://therealjameswilson.github.io",
          "CF-Connecting-IP": "198.51.100.110",
          "X-Opstalia-Packet-View": "1"
        }
      }),
      environment
    );
    expect(contentResponse.status).toBe(200);
    expect((await contentResponse.arrayBuffer()).byteLength).toBe(1000);
  });

  it("rejects a changed same-method ETag when no stronger checksum is available", async () => {
    stubOfficialPdf({
      getEtags: ["signature-get-etag", "changed-relay-etag"],
      getChecksums: [null, null]
    });
    const sessionResponse = await worker.fetch(sessionRequest("198.51.100.101"), environment);
    const session = await sessionResponse.json() as { contentUrl: string };
    const contentResponse = await worker.fetch(
      new Request(`https://opstalia-api.example${session.contentUrl}`, {
        headers: {
          Origin: "https://therealjameswilson.github.io",
          "CF-Connecting-IP": "198.51.100.102",
          "X-Opstalia-Packet-View": "1"
        }
      }),
      environment
    );
    expect(contentResponse.status).toBe(409);
  });

  it("pins the signature GET length and accepts an omitted relay Content-Length", async () => {
    stubOfficialPdf({
      getLengths: [1000, null]
    });
    const sessionResponse = await worker.fetch(sessionRequest("198.51.100.103"), environment);
    const session = await sessionResponse.json() as { contentUrl: string; byteLength: number };
    expect(session.byteLength).toBe(1000);
    const contentResponse = await worker.fetch(
      new Request(`https://opstalia-api.example${session.contentUrl}`, {
        headers: {
          Origin: "https://therealjameswilson.github.io",
          "CF-Connecting-IP": "198.51.100.104",
          "X-Opstalia-Packet-View": "1"
        }
      }),
      environment
    );
    expect(contentResponse.status).toBe(200);
    expect((await contentResponse.arrayBuffer()).byteLength).toBe(1000);
  });

  it("rejects a changed declared length before streaming", async () => {
    stubOfficialPdf({
      getLengths: [1000, 999]
    });
    const sessionResponse = await worker.fetch(sessionRequest("198.51.100.105"), environment);
    const session = await sessionResponse.json() as { contentUrl: string };
    const contentResponse = await worker.fetch(
      new Request(`https://opstalia-api.example${session.contentUrl}`, {
        headers: {
          Origin: "https://therealjameswilson.github.io",
          "CF-Connecting-IP": "198.51.100.106",
          "X-Opstalia-Packet-View": "1"
        }
      }),
      environment
    );
    expect(contentResponse.status).toBe(409);
  });

  it("permits one explicitly marked bounded derivative stream and pins its validator", async () => {
    stubOfficialPdf();
    const sessionResponse = await worker.fetch(sessionRequest("198.51.100.90"), environment);
    const session = await sessionResponse.json() as { contentUrl: string };
    const response = await worker.fetch(
      new Request(`https://opstalia-api.example${session.contentUrl}`, {
        headers: {
          Origin: "https://therealjameswilson.github.io",
          "CF-Connecting-IP": "198.51.100.91",
          "X-Opstalia-Derivative-Export": "1"
        }
      }),
      environment
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("ETag")).toBe("official-etag");
    expect((await response.arrayBuffer()).byteLength).toBe(1000);
  });

  it("terminates a declared-length stream that ends early", async () => {
    stubOfficialPdf({ getBodyLength: 900 });
    const sessionResponse = await worker.fetch(sessionRequest("198.51.100.93"), environment);
    const session = await sessionResponse.json() as { contentUrl: string };
    const response = await worker.fetch(
      new Request(`https://opstalia-api.example${session.contentUrl}`, {
        headers: {
          Origin: "https://therealjameswilson.github.io",
          "CF-Connecting-IP": "198.51.100.94",
          "X-Opstalia-Packet-View": "1"
        }
      }),
      environment
    );
    expect(response.status).toBe(200);
    await expect(response.arrayBuffer()).rejects.toThrow(/ended before/i);
  });

  it("rejects token tampering, ranges, missing purposes, deceptive paths, and redirects", async () => {
    stubOfficialPdf();
    const sessionResponse = await worker.fetch(sessionRequest("198.51.100.84"), environment);
    const session = await sessionResponse.json() as { contentUrl: string };
    const sessionUrl = new URL(`https://opstalia-api.example${session.contentUrl}`);
    const token = sessionUrl.searchParams.get("token")!;
    const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
    const tamperedResponse = await worker.fetch(
      new Request(`https://opstalia-api.example/api/pdf/content?token=${tampered}`, {
        headers: {
          Origin: "https://therealjameswilson.github.io",
          "CF-Connecting-IP": "198.51.100.85",
          "X-Opstalia-Packet-View": "1"
        }
      }),
      environment
    );
    expect(tamperedResponse.status).toBe(401);

    const rangeResponse = await worker.fetch(
      new Request(`https://opstalia-api.example${session.contentUrl}`, {
        headers: {
          Origin: "https://therealjameswilson.github.io",
          "CF-Connecting-IP": "198.51.100.86",
          Range: "bytes=0-9",
          "X-Opstalia-Packet-View": "1"
        }
      }),
      environment
    );
    expect(rangeResponse.status).toBe(416);

    const noRangeResponse = await worker.fetch(
      new Request(`https://opstalia-api.example${session.contentUrl}`, {
        headers: {
          Origin: "https://therealjameswilson.github.io",
          "CF-Connecting-IP": "198.51.100.89"
        }
      }),
      environment
    );
    expect(noRangeResponse.status).toBe(416);

    const deceptive = await worker.fetch(sessionRequest("198.51.100.87", {
      officialPdfUrl: "https://catalog.archives.gov.evil.example/medialz/presidential-libraries/bush/example.pdf"
    }), environment);
    expect(deceptive.status).toBe(400);

    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, {
      status: 302,
      headers: { Location: "https://example.com/file.pdf" }
    })));
    const redirect = await worker.fetch(sessionRequest("198.51.100.88"), environment);
    expect(redirect.status).toBe(502);
    expect(await redirect.text()).toContain("PDF_REDIRECT_REJECTED");
  });
});
