import sourceData from "../../data/sources.json";
import {
  apiSearchRequestSchema,
  sourceRegistryDataSchema,
  sourceSearchResponseSchema
} from "../../src/core/validation";
import { normalizeError, redactSecrets } from "../../src/security/redaction";
import { validateNormalizedRecordEvidence } from "../../src/security/url-policy";
import type {
  NormalizedSearchQuery,
  SourceDefinition,
  SourceSearchResponse
} from "../../src/core/types";
import {
  createWorkerAdapter,
  isWorkerSourceId,
  workerSourceIds,
  type WorkerAdapterEnvironment
} from "./adapters/registry";
import { readBoundedUtf8Body } from "./adapters/http";
import {
  createPresidentialLibraryPdfSession,
  PdfRelayError,
  relayPresidentialLibraryPdf
} from "./documents/nara-presidential-library";

export interface Environment extends WorkerAdapterEnvironment {
  FRONTEND_ORIGIN?: string;
  RATE_LIMIT_SALT?: string;
  APP_ENV?: string;
}

const MAX_BODY_BYTES = 16_384;
const RATE_LIMIT_PER_MINUTE = 30;
const MAX_RATE_LIMIT_ENTRIES = 5_000;
const limiter = new Map<string, { minute: number; count: number }>();
const registeredSources = new Map(
  sourceRegistryDataSchema
    .parse(sourceData)
    .sources.map((source) => [source.id, source as SourceDefinition])
);

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
    "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Range, If-Range, X-Opstalia-Derivative-Export, X-Opstalia-Packet-View",
    "Access-Control-Expose-Headers": "Accept-Ranges, Content-Length, Content-Range, ETag, Last-Modified, X-Opstalia-Source",
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

async function rateLimitKey(request: Request, environment: Environment, scope: string): Promise<string> {
  const address = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const material = `${environment.RATE_LIMIT_SALT ?? "ephemeral-opstalia"}|${scope}|${address}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return [...new Uint8Array(digest)].slice(0, 12).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function checkRateLimit(
  request: Request,
  environment: Environment,
  scope = "search",
  limit = RATE_LIMIT_PER_MINUTE
): Promise<boolean> {
  const key = await rateLimitKey(request, environment, scope);
  const minute = Math.floor(Date.now() / 60_000);
  if (limiter.size >= MAX_RATE_LIMIT_ENTRIES) {
    for (const [storedKey, value] of limiter) {
      if (value.minute !== minute) limiter.delete(storedKey);
    }
    while (limiter.size >= MAX_RATE_LIMIT_ENTRIES) {
      const oldestKey = limiter.keys().next().value as string | undefined;
      if (!oldestKey) break;
      limiter.delete(oldestKey);
    }
  }
  const current = limiter.get(key);
  if (!current || current.minute !== minute) {
    limiter.set(key, { minute, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

async function readJsonBody(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("Content-Length") ?? "0");
  if (!Number.isFinite(declaredLength) || declaredLength < 0) {
    throw new Error("Invalid Content-Length");
  }
  if (declaredLength > MAX_BODY_BYTES) throw new Error("Request body exceeds the 16 KB limit");
  if (!(request.headers.get("Content-Type") ?? "").toLocaleLowerCase().startsWith("application/json")) {
    throw new Error("Content-Type must be application/json");
  }
  const body = await readBoundedUtf8Body(
    request.body,
    MAX_BODY_BYTES,
    "Request body"
  );
  try {
    return JSON.parse(body);
  } catch {
    throw new Error("Invalid JSON request body");
  }
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
        ready: true,
        service: "opstalia-api",
        version: "1.2.0",
        naraSecretConfigured: Boolean(environment.NARA_API_KEY),
        govInfoSecretConfigured: Boolean(environment.GOVINFO_API_KEY),
        pdfRelayConfigured: Boolean(environment.RATE_LIMIT_SALT && environment.RATE_LIMIT_SALT.length >= 16),
        registeredAdapters: workerSourceIds,
        storagePolicy: "Upstream responses and public PDF bytes are streamed without Worker caching or persistence; user notes and search text are never stored by the Worker",
        loggingPolicy: "Request bodies, full query strings, authorization data, and IP addresses are not logged by application code"
      });
    }
    if (request.method === "POST" && url.pathname === "/api/pdf/session") {
      if (!(await checkRateLimit(request, environment, "pdf-session", 10))) {
        return json(request, environment, { error: "RATE_LIMIT", message: "Too many packet-session requests; retry after one minute." }, 429);
      }
      const timeout = withTimeout(request, 20_000);
      try {
        const session = await createPresidentialLibraryPdfSession({
          body: await readJsonBody(request),
          source: registeredSources.get("presidential-libraries"),
          secret: environment.RATE_LIMIT_SALT,
          signal: timeout.signal
        });
        return json(request, environment, session);
      } catch (error) {
        if (error instanceof PdfRelayError) {
          return json(request, environment, { error: error.code, message: error.message }, error.status);
        }
        const normalized = normalizeError(error);
        return json(request, environment, { error: normalized.code, message: normalized.message }, 400);
      } finally {
        timeout.cleanup();
      }
    }
    if (request.method === "GET" && url.pathname === "/api/pdf/content") {
      const derivativeExport = request.headers.get("X-Opstalia-Derivative-Export") === "1";
      const packetView = request.headers.get("X-Opstalia-Packet-View") === "1";
      const scope = derivativeExport ? "pdf-export" : packetView ? "pdf-view" : "pdf-content";
      const limit = derivativeExport ? 3 : packetView ? 6 : 30;
      if (!(await checkRateLimit(request, environment, scope, limit))) {
        return json(request, environment, {
          error: "RATE_LIMIT",
          message: derivativeExport
            ? "Too many full-source derivative requests; retry after one minute."
            : packetView
              ? "Too many full-source packet-view requests; retry after one minute."
              : "Too many packet-content requests; retry after one minute."
        }, 429);
      }
      const timeout = withTimeout(request, 20_000);
      try {
        const token = url.searchParams.get("token") ?? "";
        return await relayPresidentialLibraryPdf({
          request,
          token,
          secret: environment.RATE_LIMIT_SALT,
          signal: timeout.signal,
          responseHeaders: corsHeaders(request, environment)
        });
      } catch (error) {
        if (error instanceof PdfRelayError) {
          return json(request, environment, { error: error.code, message: error.message }, error.status);
        }
        const normalized = normalizeError(error);
        return json(request, environment, { error: normalized.code, message: normalized.message }, 502);
      } finally {
        timeout.cleanup();
      }
    }
    const route = url.pathname.match(/^\/api\/search\/([a-z0-9-]+)$/);
    const sourceId = route?.[1] ?? "";
    if (request.method !== "POST" || !isWorkerSourceId(sourceId)) {
      return json(request, environment, { error: "NOT_FOUND", message: "Route not found." }, 404);
    }
    if (!(await checkRateLimit(request, environment))) {
      return json(request, environment, { error: "RATE_LIMIT", message: "Too many requests; retry after one minute." }, 429);
    }
    const timeout = withTimeout(request, 15_000);
    try {
      const parsed = apiSearchRequestSchema.parse(await readJsonBody(request)) as NormalizedSearchQuery;
      const adapter = createWorkerAdapter(sourceId, environment);
      const adapterResult = sourceSearchResponseSchema.parse(
        await adapter.search(parsed, {
          signal: timeout.signal,
          retrievedAt: new Date().toISOString()
        })
      ) as SourceSearchResponse;
      const source = registeredSources.get(sourceId);
      if (
        !source ||
        adapterResult.sourceRun.sourceId !== sourceId ||
        adapterResult.rawRecords.some((record) => record.sourceId !== sourceId)
      ) {
        throw new Error("Adapter source identity did not match the fixed Worker route.");
      }
      const records = adapterResult.records.filter((record) =>
        validateNormalizedRecordEvidence(record, source).allowed
      );
      const rejectedCount = adapterResult.records.length - records.length;
      return json(request, environment, {
        ...adapterResult,
        sourceRun: {
          ...adapterResult.sourceRun,
          resultCount: records.length,
          message: rejectedCount
            ? `${adapterResult.sourceRun.message ?? ""} Worker provenance enforcement rejected ${rejectedCount} result${rejectedCount === 1 ? "" : "s"}.`.trim()
            : adapterResult.sourceRun.message
        },
        records,
        warnings: rejectedCount
          ? [
              ...adapterResult.warnings,
              `${rejectedCount} result${rejectedCount === 1 ? "" : "s"} failed Worker-side official-domain, file-URL, or adapter-provenance validation.`
            ]
          : adapterResult.warnings
      });
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
