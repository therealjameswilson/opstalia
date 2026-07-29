import { apiSearchRequestSchema } from "../core/validation";
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
import { searchFrus, searchIscap, searchNdc } from "./local-adapters";

const PUBLIC_API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "");
const SOURCE_CONCURRENCY = 4;
const SOURCE_TIMEOUT_MS = 20_000;

export function apiConfigured(): boolean {
  return Boolean(PUBLIC_API_BASE);
}

function manualResponse(source: SourceDefinition): SourceSearchResponse {
  return {
    sourceRun: {
      id: makeId("source-run"),
      sourceId: source.id,
      status: "manual_available",
      completedAt: new Date().toISOString(),
      resultCount: 0,
      message:
        source.adapterStatus === "temporarily_unavailable"
          ? "Automated access is unavailable or prohibited; an official manual link is provided."
          : "This source has an official manual-search adapter.",
      manualSearchUrl: source.manualSearchUrl
    },
    rawRecords: [],
    records: [],
    warnings: source.knownLimitations
  };
}

async function searchNara(query: NormalizedSearchQuery, signal?: AbortSignal): Promise<SourceSearchResponse> {
  if (!PUBLIC_API_BASE) {
    return {
      sourceRun: {
        id: makeId("source-run"),
        sourceId: "nara",
        status: "temporarily_unavailable",
        completedAt: new Date().toISOString(),
        resultCount: 0,
        message: "The production Worker URL is not configured. Install the Worker secrets and set VITE_API_BASE.",
        manualSearchUrl: "https://catalog.archives.gov/"
      },
      rawRecords: [],
      records: [],
      warnings: ["NARA search requires the server-side NARA_API_KEY; no API key belongs in the browser."]
    };
  }
  const validated = apiSearchRequestSchema.parse({
    ...query,
    target: {
      ...query.target,
      notes: undefined
    }
  });
  const response = await fetch(`${PUBLIC_API_BASE}/api/search/nara`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(validated),
    signal,
    cache: "no-store",
    credentials: "omit"
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: `NARA adapter returned ${response.status}` }));
    throw new Error(String((error as { message?: string }).message ?? response.status));
  }
  return (await response.json()) as SourceSearchResponse;
}

export interface FederatedSearchResult {
  sourceRuns: SourceRun[];
  records: NormalizedRecord[];
  rawRecords: SourceSearchResponse["rawRecords"];
  warnings: string[];
}

async function withSourceTimeout<T>(
  parentSignal: AbortSignal | undefined,
  work: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const forwardAbort = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) forwardAbort();
  else parentSignal?.addEventListener("abort", forwardAbort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException("Source timeout", "TimeoutError"));
  }, SOURCE_TIMEOUT_MS);
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
  signal?: AbortSignal
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
        const response = manualResponse(source);
        onRun(response.sourceRun);
        onPartial(response);
        responses.push(response);
        return;
      }
      const relevant = enabledQueries.filter((query) => !query.sourceIds.length || query.sourceIds.includes(source.id));
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
      const cappedQueries = source.id === "nara" ? relevant.slice(0, 3) : relevant;
      const sourceResponses: SourceSearchResponse[] = [];
      for (const searchQuery of cappedQueries) {
        if (sourceSignal.aborted) throw new DOMException("Search cancelled", "AbortError");
        const normalized: NormalizedSearchQuery = {
          target: plan.target,
          query: searchQuery,
          limit: 20,
          privateMode
        };
        const result =
          source.id === "nara"
            ? await searchNara(normalized, sourceSignal)
            : source.id === "frus"
              ? await searchFrus(normalized, sourceSignal)
              : source.id === "iscap"
                ? await searchIscap(normalized, sourceSignal)
                : source.id === "ndc"
                  ? await searchNdc(normalized, sourceSignal)
                  : manualResponse(source);
        sourceResponses.push(result);
      }
      const records = deduplicateRecords(sourceResponses.flatMap((response) => response.records));
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
            ? `${records.length} unique official results across ${cappedQueries.length} plan ${cappedQueries.length === 1 ? "query" : "queries"}.`
            : sourceResponses.map((response) => response.sourceRun.message).filter(Boolean).join(" ")
        },
        records,
        rawRecords: sourceResponses.flatMap((response) => response.rawRecords),
        warnings: [...new Set(sourceResponses.flatMap((response) => response.warnings))]
      };
      onRun(merged.sourceRun);
      onPartial(merged);
      responses.push(merged);
    });

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
    const body = (await response.json()) as { ready?: boolean; naraSecretConfigured?: boolean };
    return {
      ready: response.ok && Boolean(body.ready),
      message: body.naraSecretConfigured ? "Worker reachable; NARA secret is configured" : "Worker reachable; NARA secret is not configured"
    };
  } catch {
    return { ready: false, message: "Worker health check unavailable" };
  }
}
