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
