import { apiSearchRequestSchema } from "../../src/core/validation";
import { normalizeError, redactSecrets } from "../../src/security/redaction";
import type { NormalizedSearchQuery } from "../../src/core/types";
import { NaraAdapter } from "./adapters/nara";

export interface Environment {
  NARA_API_KEY?: string;
  FRONTEND_ORIGIN?: string;
  RATE_LIMIT_SALT?: string;
  APP_ENV?: string;
}

const MAX_BODY_BYTES = 16_384;
const RATE_LIMIT_PER_MINUTE = 30;
const limiter = new Map<string, { minute: number; count: number }>();

function allowedOrigins(environment: Environment): Set<string> {
  const origins = new Set(["https://therealjameswilson.github.io"]);
  if (environment.FRONTEND_ORIGIN) origins.add(environment.FRONTEND_ORIGIN.replace(/\/$/, ""));
  if (environment.APP_ENV !== "production") {
    origins.add("http://localhost:5173");
    origins.add("http://127.0.0.1:5173");
  }
  return origins;
}

function corsHeaders(request: Request, environment: Environment): Headers {
  const origin = request.headers.get("Origin") ?? "";
  const headers = new Headers({
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    "Cache-Control": "no-store, private, max-age=0",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff"
  });
  if (allowedOrigins(environment).has(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

function json(request: Request, environment: Environment, body: unknown, status = 200): Response {
  const headers = corsHeaders(request, environment);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

async function rateLimitKey(request: Request, environment: Environment): Promise<string> {
  const address = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const material = `${environment.RATE_LIMIT_SALT ?? "ephemeral-opstalia"}|${address}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return [...new Uint8Array(digest)].slice(0, 12).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function checkRateLimit(request: Request, environment: Environment): Promise<boolean> {
  const key = await rateLimitKey(request, environment);
  const minute = Math.floor(Date.now() / 60_000);
  const current = limiter.get(key);
  if (!current || current.minute !== minute) {
    limiter.set(key, { minute, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= RATE_LIMIT_PER_MINUTE;
}

async function readJsonBody(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("Content-Length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) throw new Error("Request body exceeds the 16 KB limit");
  if (!(request.headers.get("Content-Type") ?? "").toLocaleLowerCase().startsWith("application/json")) {
    throw new Error("Content-Type must be application/json");
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) throw new Error("Request body exceeds the 16 KB limit");
  return JSON.parse(body);
}

function withTimeout(request: Request, milliseconds: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new DOMException("Source timeout", "TimeoutError")), milliseconds);
  const abort = () => controller.abort(request.signal.reason);
  request.signal.addEventListener("abort", abort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      request.signal.removeEventListener("abort", abort);
    }
  };
}

const worker = {
  async fetch(request: Request, environment: Environment): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    if (origin && !allowedOrigins(environment).has(origin)) {
      return json(request, environment, { error: "CORS_ORIGIN_REJECTED", message: "Origin is not allowed." }, 403);
    }
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request, environment) });
    if (request.method === "GET" && url.pathname === "/api/health") {
      return json(request, environment, {
        ok: true,
        ready: Boolean(environment.NARA_API_KEY),
        service: "opstalia-api",
        version: "1.0.0",
        naraSecretConfigured: Boolean(environment.NARA_API_KEY),
        storagePolicy: "NARA responses are not cached or stored",
        loggingPolicy: "Request bodies, full query strings, authorization data, and IP addresses are not logged by application code"
      });
    }
    if (request.method !== "POST" || url.pathname !== "/api/search/nara") {
      return json(request, environment, { error: "NOT_FOUND", message: "Route not found." }, 404);
    }
    if (!(await checkRateLimit(request, environment))) {
      return json(request, environment, { error: "RATE_LIMIT", message: "Too many requests; retry after one minute." }, 429);
    }
    const timeout = withTimeout(request, 15_000);
    try {
      const parsed = apiSearchRequestSchema.parse(await readJsonBody(request)) as NormalizedSearchQuery;
      const adapter = new NaraAdapter(environment);
      const result = await adapter.search(parsed, { signal: timeout.signal, retrievedAt: new Date().toISOString() });
      return json(request, environment, result);
    } catch (error) {
      const normalized = normalizeError(error);
      const status =
        normalized.code === "SOURCE_RATE_LIMIT"
          ? 429
          : /body|content-type|JSON|validation|too_big|invalid/i.test(redactSecrets(error))
            ? 400
            : normalized.code === "SOURCE_TIMEOUT"
              ? 504
              : 502;
      return json(request, environment, { error: normalized.code, message: normalized.message }, status);
    } finally {
      timeout.cleanup();
    }
  }
};

export default worker;
