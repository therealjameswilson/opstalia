import type {
  DigitalObject,
  NormalizedRecord,
  NormalizedSearchQuery,
  SourceHealth,
  SourceSearchResponse,
  SourcedValue
} from "../../../src/core/types";
import { makeId } from "../../../src/core/id";
import { extractIdentifiers } from "../../../src/analysis/identifiers";
import { normalizeDate } from "../../../src/analysis/date";
import { determineReleaseStatus } from "../../../src/analysis/release-status";
import { scoreRecord } from "../../../src/analysis/scoring";
import { detectReleaseMarkings } from "../../../src/analysis/redactions";
import { assertSafeOutboundUrl } from "../../../src/security/url-policy";
import exemptionData from "../../../data/exemption-codes.json";
import type { AdapterContext, SourceAdapter } from "./types";

const NARA_SEARCH_ENDPOINT = "https://catalog.archives.gov/api/v2/records/search";
const NARA_ALLOWED_HOSTS = ["catalog.archives.gov"];
const ATTRIBUTION =
  "This product uses the National Archives Catalog API but is not endorsed or certified by the National Archives and Records Administration.";

export interface NaraAdapterEnvironment {
  NARA_API_KEY?: string;
}

function sourced<T>(value: T, source: string, confidence = 0.95): SourcedValue<T> {
  return { value, source, extractionMethod: "source_structured", confidence };
}

function stringValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value).replace(/\s+/g, " ").trim();
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return stringValue(object.heading ?? object.termName ?? object.name ?? object.title ?? object.value ?? "");
  }
  return "";
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return stringValue(value) ? [stringValue(value)] : [];
  return value.map(stringValue).filter(Boolean);
}

function structuredDate(value: unknown): string {
  if (Array.isArray(value)) return structuredDate(value[0]);
  if (!value || typeof value !== "object") return stringValue(value);
  const date = value as Record<string, unknown>;
  const logical = stringValue(date.logicalDate ?? date.date);
  if (logical) return logical;
  const year = Number(date.year);
  if (!Number.isFinite(year) || year <= 0) return "";
  const month = Number(date.month);
  const day = Number(date.day);
  return [
    String(year).padStart(4, "0"),
    Number.isFinite(month) && month > 0 ? String(month).padStart(2, "0") : "",
    Number.isFinite(day) && day > 0 ? String(day).padStart(2, "0") : ""
  ]
    .filter(Boolean)
    .join("-");
}

function dateFromRecord(record: Record<string, any>): string {
  const startValue =
    structuredDate(record.productionDates) ||
    structuredDate(record.releaseDates) ||
    structuredDate(record.broadcastDates) ||
    structuredDate(record.copyrightDates) ||
    structuredDate(record.coverageStartDate) ||
    structuredDate(record.inclusiveStartDate);
  const endValue =
    structuredDate(record.coverageEndDate) ||
    structuredDate(record.inclusiveEndDate);
  if (startValue && endValue && startValue !== endValue) return `${startValue}/${endValue}`;
  return startValue || endValue || stringValue(record.date);
}

function officialArchivesUrl(value: unknown): string | undefined {
  const url = stringValue(value);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const hostname = parsed.hostname.toLocaleLowerCase();
  return parsed.protocol === "https:" &&
    (hostname === "archives.gov" || hostname.endsWith(".archives.gov"))
    ? parsed.toString()
    : undefined;
}

function digitalObjects(record: Record<string, any>): DigitalObject[] {
  const candidates = [
    ...(Array.isArray(record.digitalObjects) ? record.digitalObjects : []),
    ...(Array.isArray(record.digitalObject) ? record.digitalObject : []),
    ...(Array.isArray(record.objects) ? record.objects : [])
  ];
  const normalized: DigitalObject[] = [];
  candidates.forEach((object: Record<string, any>, index: number) => {
    const url = officialArchivesUrl(object.objectUrl ?? object.url ?? object.downloadUrl ?? object.fileUrl);
    if (!url) return;
    normalized.push({
      id: makeId("nara-object", `${url}|${index}`),
      url,
      downloadUrl: officialArchivesUrl(object.downloadUrl ?? object.objectUrl),
      thumbnailUrl: officialArchivesUrl(object.thumbnailUrl ?? object.thumbnail),
      mediaType: stringValue(object.objectType ?? object.mimeType ?? object.mediaType ?? object.type) || undefined,
      pageNumber: Number(object.pageNumber ?? object.page) || undefined,
      ocrText: stringValue(object.ocrText ?? object.extractedText) || undefined,
      sizeBytes: Number(object.objectFileSize ?? object.size ?? object.sizeBytes) || undefined
    });
  });
  return normalized;
}

function recordFromHit(hit: Record<string, any>): Record<string, any> {
  return hit?._source?.record ?? hit?._source ?? hit?.record ?? hit;
}

function buildParameters(query: NormalizedSearchQuery): URLSearchParams {
  const target = query.target;
  const parameters = new URLSearchParams({
    q: query.query.text,
    limit: String(Math.min(50, query.limit))
  });
  const identifierText = `${target.identifiers ?? ""} ${query.query.text}`;
  const ancestorNaid = identifierText.match(/\bancestor\s+NAID[:#\s-]*(\d{4,})\b/i)?.[1];
  const directIdentifierText = identifierText.replace(/\bancestor\s+NAID[:#\s-]*\d{4,}\b/gi, "");
  const explicitNaid = directIdentifierText.match(/\bNAID[:#\s-]*(\d{4,})\b/i)?.[1];
  const bareNaid = directIdentifierText.trim().match(/^(\d{4,})$/)?.[1];
  const naid = explicitNaid ?? (query.query.kind === "identifier" ? bareNaid : undefined);
  if (naid) {
    parameters.set("naId_is", naid);
  }
  if (ancestorNaid) parameters.set("ancestorNaId", ancestorNaid);
  const recordGroup = identifierText.match(/\b(?:RG|record\s+group)[:#\s-]*(\d{1,4})\b/i)?.[1];
  if (recordGroup) parameters.set("recordGroupNumber", recordGroup);
  const collection = identifierText.match(/\bcollection[:#\s-]*([A-Z0-9][A-Z0-9._/-]{1,40})\b/i)?.[1];
  if (collection) parameters.set("collectionIdentifier", collection);
  const level = identifierText.match(/\blevel[:#\s-]*(record\s*group|collection|series|file\s*unit|item)\b/i)?.[1];
  if (level) {
    const normalizedLevel = level.replace(/\s+/g, "").replace(/^recordgroup$/i, "recordGroup").replace(/^fileunit$/i, "fileUnit");
    parameters.set("levelOfDescription", normalizedLevel);
  }
  if (target.dateFrom) parameters.set("startDate", target.dateFrom);
  if (target.dateTo) parameters.set("endDate", target.dateTo);
  if (target.titleOrSubject && query.query.kind === "exact_phrase") parameters.set("title", target.titleOrSubject);
  if (target.originatingAgency) parameters.set("creators", target.originatingAgency);
  if (target.geographicFocus) parameters.set("geographicReference", target.geographicFocus);
  if (target.documentType) {
    const materialMappings: Array<[RegExp, string]> = [
      [/\b(photo|photograph|graphic)\b/i, "Photographs and other Graphic Materials"],
      [/\b(moving image|film|video)\b/i, "Moving Images"],
      [/\b(map|chart)\b/i, "Maps and Charts"],
      [/\b(sound|audio|recording)\b/i, "Sound Recordings"],
      [/\b(data|dataset|electronic record)\b/i, "Data Files"],
      [/\b(artifact|object)\b/i, "Artifacts"],
      [/\b(architectural|engineering drawing|blueprint)\b/i, "Architectural and Engineering Drawings"],
      [/\b(text|memorandum|memo|cable|telegram|report|letter|paper|document)\b/i, "Textual Records"]
    ];
    const material = materialMappings.find(([pattern]) => pattern.test(target.documentType ?? ""))?.[1];
    if (material) parameters.set("typeOfMaterials", material);
  }
  return parameters;
}

async function fetchWithRetry(url: URL, apiKey: string, signal: AbortSignal): Promise<Response> {
  let latest: Response | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    latest = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "User-Agent": "Opstalia/1.0 official records research"
      },
      redirect: "error",
      signal,
      cf: { cacheTtl: 0, cacheEverything: false }
    } as RequestInit & { cf: { cacheTtl: number; cacheEverything: boolean } });
    if (![429, 500, 502, 503, 504].includes(latest.status) || attempt === 1) return latest;
    await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
  }
  return latest as Response;
}

export class NaraAdapter implements SourceAdapter<Record<string, any>> {
  readonly id = "nara";
  readonly name = "National Archives Catalog";

  constructor(private readonly environment: NaraAdapterEnvironment) {}

  async search(query: NormalizedSearchQuery, context: AdapterContext): Promise<SourceSearchResponse> {
    if (!this.environment.NARA_API_KEY) {
      return {
        sourceRun: {
          id: makeId("source-run"),
          sourceId: this.id,
          status: "temporarily_unavailable",
          startedAt: context.retrievedAt,
          completedAt: new Date().toISOString(),
          resultCount: 0,
          message: "NARA_API_KEY is not configured on the Worker.",
          manualSearchUrl: "https://catalog.archives.gov/"
        },
        rawRecords: [],
        records: [],
        warnings: ["Install NARA_API_KEY with Wrangler. Its value is never returned or logged."]
      };
    }
    const upstream = assertSafeOutboundUrl(NARA_SEARCH_ENDPOINT, NARA_ALLOWED_HOSTS);
    upstream.search = buildParameters(query).toString();
    const response = await fetchWithRetry(upstream, this.environment.NARA_API_KEY, context.signal);
    if (!response.ok) {
      const error = new Error(
        response.status === 429 ? "NARA API rate limit reached (429)" : `NARA API returned ${response.status}`
      );
      throw error;
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLocaleLowerCase().includes("application/json")) {
      throw new Error("NARA API did not return JSON; the key may be missing, inactive, or the query may have been misrouted");
    }
    const body = (await response.json()) as Record<string, any>;
    const payload = body.body ?? body;
    const hits = payload?.hits?.hits;
    if (!Array.isArray(hits)) throw new Error("NARA API response did not match the documented search-result schema");
    const records = hits.flatMap((hit: Record<string, any>) => this.normalize(hit, query, context));
    return {
      sourceRun: {
        id: makeId("source-run"),
        sourceId: this.id,
        status: records.length ? "complete" : "no_results",
        startedAt: context.retrievedAt,
        completedAt: new Date().toISOString(),
        resultCount: records.length,
        message: records.length
          ? `${records.length} transient NARA results. API content is not cached or persisted.`
          : "No NARA Catalog records matched this query."
      },
      rawRecords: [],
      records,
      warnings: [
        ATTRIBUTION,
        "NARA API content is memory-only. Saving retains a generated NAID/official-URL locator and researcher-created data, not the API response."
      ]
    };
  }

  normalize(rawHit: Record<string, any>, query: NormalizedSearchQuery, context: AdapterContext): NormalizedRecord[] {
    const record = recordFromHit(rawHit);
    const naid = stringValue(record.naId ?? record.naid ?? rawHit._id);
    if (!naid || !/^\d+$/.test(naid)) return [];
    const officialUrl = `https://catalog.archives.gov/id/${naid}`;
    const objects = digitalObjects(record);
    const sourceText = [
      stringValue(record.scopeAndContentNote),
      stringValue(record.title),
      ...objects.map((object) => object.ocrText ?? "")
    ].join(" ");
    const markings = detectReleaseMarkings(sourceText, exemptionData.codes, undefined);
    const visibleCodes = [...new Set(markings.map((marking) => marking.code).filter((code): code is string => Boolean(code)))];
    const normalizedDate = normalizeDate(dateFromRecord(record));
    const ancestors = Array.isArray(record.ancestors) ? record.ancestors : [];
    const collection = ancestors
      .map((ancestor: Record<string, any>) => stringValue(ancestor.title ?? ancestor.collectionTitle))
      .filter(Boolean)
      .slice(0, 3)
      .join(" › ");
    const creatorNames = stringArray(record.creators ?? record.creator);
    const subjectNames = stringArray(
      record.subjects ??
        record.topicalSubjects ??
        record.topicalSubject ??
        record.generalRecordsTypes ??
        record.generalRecordsType
    );
    const title = stringValue(record.title) || `NARA Catalog record ${naid}`;
    const normalized: NormalizedRecord = {
      id: makeId("nara", naid),
      title: sourced(title, "NARA Catalog API"),
      date: normalizedDate.iso ? sourced(normalizedDate.iso, "NARA Catalog API") : undefined,
      datePrecision: sourced(normalizedDate.precision, "Opstalia date normalization", 0.85),
      originatingAgency: creatorNames.length ? sourced(creatorNames.join("; "), "NARA Catalog API") : undefined,
      documentType: stringValue(record.levelOfDescription)
        ? sourced(stringValue(record.levelOfDescription), "NARA Catalog API")
        : undefined,
      subject: subjectNames.length ? sourced(subjectNames, "NARA Catalog API") : undefined,
      sourceRepository: sourced("National Archives Catalog", "NARA Catalog API"),
      sourceCollection: collection ? sourced(collection, "NARA Catalog API") : undefined,
      officialUrl: sourced(officialUrl, "NARA Catalog API"),
      downloadUrl: objects[0]?.downloadUrl ? sourced(objects[0].downloadUrl, "NARA Catalog API") : undefined,
      recordPageUrl: sourced(officialUrl, "NARA Catalog API"),
      thumbnailUrl: objects[0]?.thumbnailUrl ? sourced(objects[0].thumbnailUrl, "NARA Catalog API") : undefined,
      naraNaid: sourced(naid, "NARA Catalog API"),
      archivalCitation: stringValue(record.archivalDescriptions)
        ? sourced(stringValue(record.archivalDescriptions), "NARA Catalog API")
        : undefined,
      documentNumber: stringValue(record.localIdentifier ?? record.controlNumbers)
        ? sourced(stringValue(record.localIdentifier ?? record.controlNumbers), "NARA Catalog API")
        : undefined,
      pageCount: Number(record.pageCount) ? sourced(Number(record.pageCount), "NARA Catalog API") : undefined,
      digitizationStatus: sourced(objects.length ? "Digital objects reported" : "No public digital object reported", "NARA Catalog API"),
      ocrAvailability: sourced(objects.some((object) => Boolean(object.ocrText)), "NARA Catalog API"),
      releaseStatus: determineReleaseStatus(
        {
          hasDigitalObject: objects.length > 0,
          hasRedactionMarking: markings.length > 0,
          metadataOnly: objects.length === 0
        },
        "NARA Catalog API"
      ),
      exemptionCodes: visibleCodes,
      classificationMarkings: markings,
      extractedIdentifiers: extractIdentifiers(`${naid} ${sourceText} ${stringValue(record.localIdentifier)}`),
      textSnippet: stringValue(record.scopeAndContentNote)
        ? sourced(stringValue(record.scopeAndContentNote).slice(0, 1200), "NARA Catalog API")
        : undefined,
      digitalObjects: objects,
      provenance: {
        adapterId: this.id,
        sourceId: this.id,
        officialDomain: "catalog.archives.gov",
        officialRecordUrl: officialUrl,
        retrievalTimestamp: context.retrievedAt,
        normalizationVersion: "1.0.0"
      },
      retrievalTimestamp: context.retrievedAt,
      confidenceScore: 0,
      matchExplanation: [],
      review: { disposition: "unreviewed" }
    };
    const score = scoreRecord(normalized, query.target);
    normalized.confidenceScore = score.score;
    normalized.matchExplanation = score.factors;
    return [normalized];
  }

  async healthCheck(): Promise<SourceHealth> {
    return {
      sourceId: this.id,
      status: this.environment.NARA_API_KEY ? "healthy" : "unavailable",
      checkedAt: new Date().toISOString(),
      secretConfigured: Boolean(this.environment.NARA_API_KEY),
      message: this.environment.NARA_API_KEY
        ? "NARA secret is configured; an actual schema-validating search is still the operational health check."
        : "NARA_API_KEY is not configured."
    };
  }
}
