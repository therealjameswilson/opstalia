import { describe, expect, it } from "vitest";
import worker from "../../worker/src/index";

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

describe("Worker request boundary", () => {
  it("reports secret readiness without returning a secret value", async () => {
    const response = await worker.fetch(
      new Request("https://opstalia-api.example/api/health", { headers: { Origin: "https://therealjameswilson.github.io" } }),
      { NARA_API_KEY: "do-not-return-this-value", APP_ENV: "production" }
    );
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).toContain('"naraSecretConfigured":true');
    expect(text).not.toContain("do-not-return-this-value");
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
  });
});
