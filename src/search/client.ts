import {
  apiSearchRequestSchema,
  sourceSearchResponseSchema
} from "../core/validation";
import { makeId } from "../core/id";
import type {
  NormalizedRecord,
  NormalizedSearchQuery,
  SearchPlan,
  SourceDefinition,
  SourceRun,
  SourceSearchResponse
} from "../core/types";
import { deduplicateRecords } from "../analysis/versioning";
import { normalizeError } from "../security/redaction";
import { validateNormalizedRecordEvidence } from "../security/url-policy";
import { searchFrus, searchIscap, searchNdc } from "./local-adapters";
import { buildManualSearchHandoff } from "./manual-handoff";

const PUBLIC_API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "");
const SOURCE_CONCURRENCY = 4;
const SOURCE_TIMEOUT_MS = 20_000;
const NARA_WORKER_SOURCE_IDS = new Set([
  "nara",
  "nara-cia-rg263",
  "nara-state-rg59"
]);
const WORKER_SOURCE_IDS = new Set([
  ...NARA_WORKER_SOURCE_IDS,
  "govinfo",
  "nasa-ntrs",
  "osti-sti"
]);

export function apiConfigured(): boolean {
  return Boolean(PUBLIC_API_BASE);
}

function manualResponse(source: SourceDefinition, plan: SearchPlan): SourceSearchResponse {
  const handoff = buildManualSearchHandoff(source, plan);
  const unavailable = source.adapterStatus === "temporarily_unavailable" || handoff.status === "unavailable";
  return {
    sourceRun: {
      id: makeId("source-run"),
      sourceId: source.id,
      status: unavailable ? "temporarily_unavailable" : "manual_available",
      completedAt: new Date().toISOString(),
      resultCount: 0,
      message: unavailable
        ? "The official source is unavailable upstream. Prepared terms, service information, and a safe retry are available."
        : "Prepared a user-initiated search on the official source. Opstalia did not retrieve or count the results.",
      manualSearchUrl: handoff.queryUrl ?? source.manualSearchUrl,
      manualHandoff: handoff
    },
    rawRecords: [],
    records: [],
    warnings: [...new Set([...handoff.warnings, ...source.knownLimitations])]
  };
}

function plannedResponse(source: SourceDefinition): SourceSearchResponse {
  return {
    sourceRun: {
      id: makeId("source-run"),
      sourceId: source.id,
      status: "blocked",
      completedAt: new Date().toISOString(),
      resultCount: 0,
      message:
        "This registry entry is planned and has no automated or manual-search adapter in Opstalia 1.0."
    },
    rawRecords: [],
    records: [],
    warnings: [...source.knownLimitations]
  };
}

async function searchWorkerSource(
  source: SourceDefinition,
  query: NormalizedSearchQuery,
  signal?: AbortSignal
): Promise<SourceSearchResponse> {
  if (!PUBLIC_API_BASE) {
    return {
      sourceRun: {
        id: makeId("source-run"),
        sourceId: source.id,
        status: "temporarily_unavailable",
        completedAt: new Date().toISOString(),
        resultCount: 0,
        message:
          "The production Worker URL is not configured. Deploy the Worker and set VITE_API_BASE; NARA and GovInfo additionally require their server-side API secrets.",
        manualSearchUrl: source.manualSearchUrl
      },
      rawRecords: [],
      records: [],
      warnings: source.id === "govinfo"
        ? ["GovInfo search requires a server-side GOVINFO_API_KEY; no API key belongs in the browser."]
        : NARA_WORKER_SOURCE_IDS.has(source.id)
          ? [
              "NARA search requires the server-side NARA_API_KEY; no API key belongs in the browser.",
              ...(source.id === "nara"
                ? []
                : [
                    `This automated profile searches the NARA Catalog only; it does not search the native ${source.id === "nara-cia-rg263" ? "CIA FOIA Electronic Reading Room" : "Department of State FOIA Virtual Reading Room"}.`
                  ])
            ]
          : ["This official public API is routed through the Opstalia Worker because the upstream does not provide a supported browser CORS interface."]
    };
  }
  const validated = apiSearchRequestSchema.parse({
    ...query,
    target: {
      ...query.target,
      notes: undefined
    }
  });
  const response = await fetch(`${PUBLIC_API_BASE}/api/search/${source.id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(validated),
    signal,
    cache: "no-store",
    credentials: "omit"
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: `${source.displayName} adapter returned ${response.status}` }));
    throw new Error(String((error as { message?: string }).message ?? response.status));
  }
  const result = sourceSearchResponseSchema.parse(
    await response.json()
  ) as SourceSearchResponse;
  if (
    result.sourceRun.sourceId !== source.id ||
    result.rawRecords.some((record) => record.sourceId !== source.id)
  ) {
    throw new Error("Worker adapter response source identity did not match the selected registry source.");
  }
  const acceptedRecords = result.records.filter((record) =>
    validateNormalizedRecordEvidence(record, source).allowed
  );
  const rejectedCount = result.records.length - acceptedRecords.length;
  return {
    ...result,
    sourceRun: {
      ...result.sourceRun,
      resultCount: acceptedRecords.length,
      message: rejectedCount
        ? `${result.sourceRun.message ?? ""} Opstalia rejected ${rejectedCount} result${rejectedCount === 1 ? "" : "s"} that failed the official-domain, file-URL, or adapter-provenance gate.`.trim()
        : result.sourceRun.message
    },
    records: acceptedRecords,
    warnings: rejectedCount
      ? [
          ...result.warnings,
          `${rejectedCount} Worker result${rejectedCount === 1 ? "" : "s"} failed the official-domain, file-URL, or adapter-provenance gate and did not enter the primary index.`
        ]
      : result.warnings
  };
}

export interface FederatedSearchResult {
  sourceRuns: SourceRun[];
  records: NormalizedRecord[];
  rawRecords: SourceSearchResponse["rawRecords"];
  warnings: string[];
}

async function withSourceTimeout<T>(
  parentSignal: AbortSignal | undefined,
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs = SOURCE_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const forwardAbort = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) forwardAbort();
  else parentSignal?.addEventListener("abort", forwardAbort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException("Source timeout", "TimeoutError"));
  }, timeoutMs);
  try {
    return await work(controller.signal);
  } catch (error) {
    if (timedOut) throw new Error("Source timeout", { cause: error });
    throw error;
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", forwardAbort);
  }
}

export async function runFederatedSearch(
  plan: SearchPlan,
  sources: SourceDefinition[],
  privateMode: boolean,
  onRun: (run: SourceRun) => void,
  onPartial: (response: SourceSearchResponse) => void,
  signal?: AbortSignal,
  sourceTimeoutMs = SOURCE_TIMEOUT_MS
): Promise<FederatedSearchResult> {
  const enabledQueries = plan.queries.filter((query) => query.enabled);
  const responses: SourceSearchResponse[] = [];
  for (const source of sources) {
    onRun({
      id: makeId("source-run"),
      sourceId: source.id,
      status: "waiting",
      startedAt: new Date().toISOString(),
      resultCount: 0
    });
  }

  const executeSource = async (source: SourceDefinition): Promise<void> =>
    withSourceTimeout(signal, async (sourceSignal) => {
      onRun({
        id: makeId("source-run"),
        sourceId: source.id,
        status: source.searchCapability === "automated" ? "searching" : "waiting",
        startedAt: new Date().toISOString(),
        resultCount: 0
      });
      if (source.searchCapability !== "automated") {
        const response =
          source.searchCapability === "manual" ? manualResponse(source, plan) : plannedResponse(source);
        onRun(response.sourceRun);
        onPartial(response);
        responses.push(response);
        return;
      }
      const targetedQueries = enabledQueries.filter(
        (query) => query.sourceIds.includes(source.id)
      );
      const relevant = targetedQueries;
      if (!relevant.length) {
        const response: SourceSearchResponse = {
          sourceRun: {
            id: makeId("source-run"),
            sourceId: source.id,
            status: "no_results",
            completedAt: new Date().toISOString(),
            resultCount: 0,
            message: "No enabled query in the plan targets this source."
          },
          rawRecords: [],
          records: [],
          warnings: []
        };
        onRun(response.sourceRun);
        onPartial(response);
        responses.push(response);
        return;
      }
      const cappedQueries = WORKER_SOURCE_IDS.has(source.id) ? relevant.slice(0, 3) : relevant;
      const sourceResponses: SourceSearchResponse[] = [];
      const appendFailedQuery = (label: string, message: string) => {
        sourceResponses.push({
          sourceRun: {
            id: makeId("source-run"),
            sourceId: source.id,
            status: "temporarily_unavailable",
            completedAt: new Date().toISOString(),
            resultCount: 0,
            message: `${label}: ${message}`,
            manualSearchUrl: source.manualSearchUrl
          },
          rawRecords: [],
          records: [],
          warnings: [
            `${label} failed without discarding other completed ${source.displayName} query results: ${message}`
          ]
        });
      };
      for (const searchQuery of cappedQueries) {
        if (sourceSignal.aborted) {
          if (signal?.aborted) throw new DOMException("Search cancelled", "AbortError");
          appendFailedQuery(searchQuery.label, "Source timeout");
          break;
        }
        const normalized: NormalizedSearchQuery = {
          target: plan.target,
          query: searchQuery,
          limit: 20,
          privateMode
        };
        try {
          const result =
            WORKER_SOURCE_IDS.has(source.id)
              ? await searchWorkerSource(source, normalized, sourceSignal)
              : source.id === "frus"
                ? await searchFrus(normalized, sourceSignal)
                : source.id === "iscap"
                  ? await searchIscap(normalized, sourceSignal)
                  : source.id === "ndc"
                    ? await searchNdc(normalized, sourceSignal)
                    : manualResponse(source, plan);
          sourceResponses.push(result);
        } catch (error) {
          if (sourceSignal.aborted && signal?.aborted) throw error;
          const message = sourceSignal.aborted
            ? "Source timeout"
            : normalizeError(error).message;
          appendFailedQuery(searchQuery.label, message);
          if (sourceSignal.aborted) break;
        }
      }
      const records = deduplicateRecords(sourceResponses.flatMap((response) => response.records));
      const failedQueryCount = sourceResponses.filter(
        (response) =>
          response.sourceRun.status === "temporarily_unavailable" ||
          response.sourceRun.status === "blocked"
      ).length;
      const hasGenericNaraProfileHits = sourceResponses.some((response) =>
        response.sourceRun.message?.includes("labeled generic NARA")
      );
      const hasRejectedNaraProfileConflicts = sourceResponses.some((response) =>
        response.sourceRun.message?.includes("record-group conflict")
      );
      const merged: SourceSearchResponse = {
        sourceRun: {
          id: makeId("source-run"),
          sourceId: source.id,
          status: records.length
            ? "complete"
            : sourceResponses.some((response) => response.sourceRun.status === "temporarily_unavailable")
              ? "temporarily_unavailable"
              : "no_results",
          startedAt: sourceResponses[0]?.sourceRun.startedAt,
          completedAt: new Date().toISOString(),
          resultCount: records.length,
          message: records.length
            ? `${records.length} unique official results across ${cappedQueries.length} plan ${cappedQueries.length === 1 ? "query" : "queries"}.${failedQueryCount ? ` ${failedQueryCount} ${failedQueryCount === 1 ? "query failed" : "queries failed"} without discarding these results.` : ""}${hasGenericNaraProfileHits ? " Some profile hits remain generic NARA evidence pending hierarchy review." : ""}${hasRejectedNaraProfileConflicts ? " Explicit record-group conflicts were rejected." : ""}`
            : sourceResponses.map((response) => response.sourceRun.message).filter(Boolean).join(" "),
          manualSearchUrl: sourceResponses.find((response) => response.sourceRun.manualSearchUrl)?.sourceRun.manualSearchUrl
        },
        records,
        rawRecords: sourceResponses.flatMap((response) => response.rawRecords),
        warnings: [...new Set(sourceResponses.flatMap((response) => response.warnings))]
      };
      onRun(merged.sourceRun);
      onPartial(merged);
      responses.push(merged);
    }, sourceTimeoutMs);

  let nextSourceIndex = 0;
  const runner = async () => {
    while (nextSourceIndex < sources.length) {
      const sourceIndex = nextSourceIndex;
      nextSourceIndex += 1;
      const source = sources[sourceIndex];
      try {
        await executeSource(source);
      } catch (error) {
        const normalized = normalizeError(error);
        const run: SourceRun = {
          id: makeId("source-run"),
          sourceId: source.id,
          status: signal?.aborted ? "cancelled" : normalized.code === "SOURCE_RATE_LIMIT" ? "temporarily_unavailable" : "temporarily_unavailable",
          completedAt: new Date().toISOString(),
          resultCount: 0,
          message: normalized.message,
          manualSearchUrl: source.manualSearchUrl
        };
        onRun(run);
        const response = { sourceRun: run, rawRecords: [], records: [], warnings: [normalized.message] };
        onPartial(response);
        responses.push(response);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(SOURCE_CONCURRENCY, sources.length) }, () => runner())
  );
  return {
    sourceRuns: responses.map((response) => response.sourceRun),
    records: deduplicateRecords(responses.flatMap((response) => response.records)).sort(
      (left, right) => right.confidenceScore - left.confidenceScore
    ),
    rawRecords: responses.flatMap((response) => response.rawRecords),
    warnings: [...new Set(responses.flatMap((response) => response.warnings))]
  };
}

export async function checkBackendHealth(signal?: AbortSignal): Promise<{ ready: boolean; message: string }> {
  if (!PUBLIC_API_BASE) return { ready: false, message: "Worker URL not configured" };
  try {
    const response = await fetch(`${PUBLIC_API_BASE}/api/health`, { signal, cache: "no-store", credentials: "omit" });
    const body = (await response.json()) as {
      ready?: boolean;
      naraSecretConfigured?: boolean;
      govInfoSecretConfigured?: boolean;
    };
    const configured = [
      body.naraSecretConfigured ? "NARA" : undefined,
      body.govInfoSecretConfigured ? "GovInfo" : undefined
    ].filter(Boolean);
    return {
      ready: response.ok && Boolean(body.ready),
      message: `Worker reachable; public API adapters are available; ${
        configured.length ? `${configured.join(" and ")} ${configured.length === 1 ? "secret is" : "secrets are"} configured` : "NARA and GovInfo secrets are not configured"
      }`
    };
  } catch {
    return { ready: false, message: "Worker health check unavailable" };
  }
}
