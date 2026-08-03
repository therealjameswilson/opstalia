import type {
  DigitalObject,
  NormalizedRecord,
  NormalizedSearchQuery,
  SourceHealth,
  SourceSearchResponse,
  SourcedValue
} from "../../../src/core/types";
import { makeId } from "../../../src/core/id";
import { normalizeDate } from "../../../src/analysis/date";
import { extractIdentifiers } from "../../../src/analysis/identifiers";
import { scoreRecord } from "../../../src/analysis/scoring";
import { assertSafeOutboundUrl } from "../../../src/security/url-policy";
import type { AdapterContext, SourceAdapter } from "./types";
import { readBoundedJsonResponse } from "./http";

const GOVINFO_SEARCH_ENDPOINT = "https://api.govinfo.gov/search";
const GOVINFO_ALLOWED_HOSTS = ["api.govinfo.gov", "govinfo.gov"];
const SOURCE_NAME = "GovInfo";
const MAX_GOVINFO_RESPONSE_BYTES = 5_000_000;

export interface GovInfoAdapterEnvironment {
  GOVINFO_API_KEY?: string;
}

interface GovInfoResult {
  title?: unknown;
  packageId?: unknown;
  granuleId?: unknown;
  lastModified?: unknown;
  governmentAuthor?: unknown;
  dateIssued?: unknown;
  collectionCode?: unknown;
  dateIngested?: unknown;
  resultLink?: unknown;
  download?: Record<string, unknown>;
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).replace(/\s+/g, " ").trim()
    : "";
}

function textArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : text(value) ? [text(value)] : [];
}

function sourced<T>(value: T, source = "GovInfo Search Service"): SourcedValue<T> {
  return { value, source, extractionMethod: "source_structured", confidence: 0.95 };
}

function canonicalRecordUrl(packageId: string, granuleId: string): string {
  const path = granuleId && granuleId !== packageId
    ? `${encodeURIComponent(packageId)}/${encodeURIComponent(granuleId)}`
    : encodeURIComponent(packageId);
  return `https://www.govinfo.gov/app/details/${path}`;
}

function publicPdfUrl(raw: GovInfoResult, packageId: string, granuleId: string): string | undefined {
  const apiPdf = text(raw.download?.pdfLink);
  if (!apiPdf) return undefined;
  let parsed: URL;
  try {
    parsed = assertSafeOutboundUrl(apiPdf, ["api.govinfo.gov"]);
  } catch {
    return undefined;
  }
  const expectedPackagePath = `/packages/${packageId}/pdf`;
  const expectedGranulePath = `/packages/${packageId}/granules/${granuleId}/pdf`;
  if (
    parsed.pathname !== expectedPackagePath &&
    (!granuleId || parsed.pathname !== expectedGranulePath)
  ) {
    return undefined;
  }
  const encodedPackage = encodeURIComponent(packageId);
  const filename = encodeURIComponent(granuleId || packageId);
  return `https://www.govinfo.gov/content/pkg/${encodedPackage}/pdf/${filename}.pdf`;
}

export class GovInfoAdapter implements SourceAdapter<GovInfoResult> {
  readonly id = "govinfo";
  readonly name = SOURCE_NAME;

  constructor(private readonly environment: GovInfoAdapterEnvironment) {}

  async search(query: NormalizedSearchQuery, context: AdapterContext): Promise<SourceSearchResponse> {
    if (!this.environment.GOVINFO_API_KEY) {
      return {
        sourceRun: {
          id: makeId("source-run"),
          sourceId: this.id,
          status: "temporarily_unavailable",
          startedAt: context.retrievedAt,
          completedAt: new Date().toISOString(),
          resultCount: 0,
          message: "GOVINFO_API_KEY is not configured on the Worker.",
          manualSearchUrl: "https://www.govinfo.gov/app/search/advanced"
        },
        rawRecords: [],
        records: [],
        warnings: ["Install GOVINFO_API_KEY with Wrangler. Its value is never returned or logged."]
      };
    }

    const upstream = assertSafeOutboundUrl(GOVINFO_SEARCH_ENDPOINT, GOVINFO_ALLOWED_HOSTS);
    upstream.searchParams.set("api_key", this.environment.GOVINFO_API_KEY);
    const response = await fetch(upstream, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "Opstalia/1.0 official records research"
      },
      body: JSON.stringify({
        query: query.query.text,
        pageSize: Math.min(query.limit, 50),
        offsetMark: query.cursor ?? "*",
        sorts: [{ field: "score", sortOrder: "DESC" }]
      }),
      redirect: "manual",
      signal: context.signal,
      cf: { cacheTtl: 0, cacheEverything: false }
    } as RequestInit & { cf: { cacheTtl: number; cacheEverything: boolean } });

    if (!response.ok) {
      throw new Error(
        response.status === 429 ? "GovInfo API rate limit reached (429)" : `GovInfo API returned ${response.status}`
      );
    }
    const payload = (await readBoundedJsonResponse(
      response,
      "GovInfo API",
      MAX_GOVINFO_RESPONSE_BYTES
    )) as { results?: unknown; count?: unknown; offsetMark?: unknown };
    if (!Array.isArray(payload.results)) throw new Error("GovInfo response did not match its documented result schema");
    const rawResults = payload.results as GovInfoResult[];
    const records = rawResults.flatMap((record) => this.normalize(record, query, context));
    return {
      sourceRun: {
        id: makeId("source-run"),
        sourceId: this.id,
        status: records.length ? "complete" : "no_results",
        startedAt: context.retrievedAt,
        completedAt: new Date().toISOString(),
        resultCount: records.length,
        message: records.length
          ? `${records.length} official-publication results from the GovInfo Search Service.`
          : "No GovInfo publications matched this query."
      },
      rawRecords: rawResults.map((payloadRecord, index) => ({
        id: makeId("raw-govinfo", `${context.retrievedAt}|${index}`),
        sourceId: this.id,
        retrievalTimestamp: context.retrievedAt,
        payload: payloadRecord
      })),
      records,
      warnings: [
        "GovInfo is an official publication repository. A result is not, by itself, evidence of an agency declassification or full-release determination.",
        "The GovInfo Search Service is documented as a public preview and may change."
      ]
    };
  }

  normalize(raw: GovInfoResult, query: NormalizedSearchQuery, context: AdapterContext): NormalizedRecord[] {
    const packageId = text(raw.packageId);
    const granuleId = text(raw.granuleId);
    if (!packageId || !/^[A-Za-z0-9._-]+$/.test(packageId)) return [];
    if (granuleId && !/^[A-Za-z0-9._-]+$/.test(granuleId)) return [];
    const officialUrl = canonicalRecordUrl(packageId, granuleId);
    const pdfUrl = publicPdfUrl(raw, packageId, granuleId);
    const title = text(raw.title) || `GovInfo publication ${packageId}`;
    const authors = textArray(raw.governmentAuthor);
    const normalizedDate = normalizeDate(text(raw.dateIssued));
    const identifiers = extractIdentifiers(`${packageId} ${granuleId} ${title}`);
    const digitalObjects: DigitalObject[] = pdfUrl
      ? [{ id: makeId("govinfo-pdf", packageId), url: pdfUrl, downloadUrl: pdfUrl, mediaType: "application/pdf" }]
      : [];
    const record: NormalizedRecord = {
      id: makeId("govinfo", granuleId || packageId),
      title: sourced(title),
      date: normalizedDate.iso ? sourced(normalizedDate.iso) : undefined,
      datePrecision: sourced(normalizedDate.precision, "Opstalia date normalization"),
      originatingAgency: authors.length ? sourced(authors.join("; ")) : undefined,
      sourceRepository: sourced(SOURCE_NAME),
      sourceCollection: text(raw.collectionCode) ? sourced(text(raw.collectionCode)) : undefined,
      officialUrl: sourced(officialUrl),
      recordPageUrl: sourced(officialUrl),
      downloadUrl: pdfUrl ? sourced(pdfUrl) : undefined,
      documentNumber: sourced(granuleId || packageId),
      digitizationStatus: sourced(pdfUrl ? "Official PDF link derived from package identifier" : "Official metadata result"),
      ocrAvailability: sourced(false),
      releaseStatus: {
        status: pdfUrl ? "not_determined" : "metadata_only",
        determinationBasis: pdfUrl
          ? "An official publication file is present, but GovInfo does not establish an agency declassification or full-release status"
          : "The search result supplies official publication metadata without a directly derived public file",
        source: "GovInfo Search Service and Opstalia cautious release-status policy",
        confidence: 0.95,
        humanReview: true
      },
      exemptionCodes: [],
      classificationMarkings: [],
      extractedIdentifiers: identifiers,
      digitalObjects,
      provenance: {
        adapterId: this.id,
        sourceId: this.id,
        officialDomain: "www.govinfo.gov",
        officialRecordUrl: officialUrl,
        retrievalTimestamp: context.retrievedAt,
        normalizationVersion: "1.0.0"
      },
      retrievalTimestamp: context.retrievedAt,
      confidenceScore: 0,
      matchExplanation: [],
      review: { disposition: "unreviewed" }
    };
    const score = scoreRecord(record, query.target);
    record.confidenceScore = score.score;
    record.matchExplanation = score.factors;
    return [record];
  }

  async healthCheck(): Promise<SourceHealth> {
    return {
      sourceId: this.id,
      status: this.environment.GOVINFO_API_KEY ? "healthy" : "unavailable",
      checkedAt: new Date().toISOString(),
      secretConfigured: Boolean(this.environment.GOVINFO_API_KEY),
      message: this.environment.GOVINFO_API_KEY
        ? "GovInfo API secret is configured; a schema-validating search remains the operational health check."
        : "GOVINFO_API_KEY is not configured."
    };
  }
}
