import type {
  DigitalObject,
  NormalizedRecord,
  NormalizedSearchQuery,
  SourceHealth,
  SourceSearchResponse,
  SourcedValue
} from "../../../src/core/types";
import { normalizeDate } from "../../../src/analysis/date";
import { extractIdentifiers } from "../../../src/analysis/identifiers";
import { scoreRecord } from "../../../src/analysis/scoring";
import { makeId } from "../../../src/core/id";
import {
  assertSafeOutboundUrl,
  canonicalNtrsDownloadPath
} from "../../../src/security/url-policy";
import type { AdapterContext, SourceAdapter } from "./types";
import { readBoundedJsonResponse } from "./http";

const NTRS_ENDPOINT = "https://ntrs.nasa.gov/api/citations/search";
const NTRS_ALLOWED_HOSTS = ["ntrs.nasa.gov"];
const MAX_NTRS_RESPONSE_BYTES = 5_000_000;

interface NtrsDownload {
  mimetype?: unknown;
  name?: unknown;
  links?: Record<string, unknown>;
}

interface NtrsResult {
  id?: unknown;
  title?: unknown;
  abstract?: unknown;
  distribution?: unknown;
  distributionDate?: unknown;
  publicationDate?: unknown;
  submittedDate?: unknown;
  publications?: unknown;
  stiType?: unknown;
  stiTypeDetails?: unknown;
  subjectCategories?: unknown;
  otherReportNumbers?: unknown;
  reportNumber?: unknown;
  authorAffiliations?: unknown;
  downloads?: unknown;
  downloadsAvailable?: unknown;
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).replace(/\s+/g, " ").trim()
    : "";
}

function sourced<T>(value: T, source = "NASA Technical Reports Server API"): SourcedValue<T> {
  return { value, source, extractionMethod: "source_structured", confidence: 0.95 };
}

function authorNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return "";
      const author = (entry as { meta?: { author?: { name?: unknown } } }).meta?.author?.name;
      return text(author);
    })
    .filter(Boolean);
}

function officialDownloads(
  download: NtrsDownload,
  citationId: string
): DigitalObject[] {
  const candidates: Array<{ path: string; mediaType?: string }> = [
    {
      path: text(download.links?.pdf ?? download.links?.original),
      mediaType: text(download.mimetype) || "application/pdf"
    },
    { path: text(download.links?.fulltext), mediaType: "text/plain" }
  ];
  const seen = new Set<string>();
  return candidates.flatMap(({ path, mediaType }) => {
    const canonicalPath = path
      ? canonicalNtrsDownloadPath(path, citationId)
      : undefined;
    if (!canonicalPath || seen.has(canonicalPath)) return [];
    seen.add(canonicalPath);
    const url = `https://ntrs.nasa.gov${canonicalPath}`;
    return [{
      id: makeId("ntrs-object", url),
      url,
      downloadUrl: url,
      mediaType
    }];
  });
}

export class NtrsAdapter implements SourceAdapter<NtrsResult> {
  readonly id = "nasa-ntrs";
  readonly name = "NASA Technical Reports Server";

  async search(query: NormalizedSearchQuery, context: AdapterContext): Promise<SourceSearchResponse> {
    const upstream = assertSafeOutboundUrl(NTRS_ENDPOINT, NTRS_ALLOWED_HOSTS);
    upstream.searchParams.set("q", query.query.text);
    upstream.searchParams.set("page.size", String(Math.min(query.limit, 50)));
    upstream.searchParams.set("page.from", query.cursor && /^\d+$/.test(query.cursor) ? query.cursor : "0");
    if (query.target.titleOrSubject) upstream.searchParams.set("title", query.target.titleOrSubject);
    if (query.target.authorSender) upstream.searchParams.set("author", query.target.authorSender);
    if (query.target.identifiers) upstream.searchParams.set("reportNumber", query.target.identifiers);
    if (query.target.dateFrom) upstream.searchParams.set("published.at", query.target.dateFrom);

    const response = await fetch(upstream, {
      headers: { Accept: "application/json", "User-Agent": "Opstalia/1.0 official records research" },
      redirect: "manual",
      signal: context.signal,
      cf: { cacheTtl: 0, cacheEverything: false }
    } as RequestInit & { cf: { cacheTtl: number; cacheEverything: boolean } });
    if (!response.ok) {
      throw new Error(
        response.status === 429 ? "NASA NTRS rate limit reached (429)" : `NASA NTRS API returned ${response.status}`
      );
    }
    const payload = (await readBoundedJsonResponse(
      response,
      "NASA NTRS",
      MAX_NTRS_RESPONSE_BYTES
    )) as { results?: unknown; stats?: { total?: unknown } };
    if (!Array.isArray(payload.results)) throw new Error("NASA NTRS response did not match its documented result schema");
    const rawResults = payload.results as NtrsResult[];
    const records = rawResults.flatMap((raw) => this.normalize(raw, query, context));
    return {
      sourceRun: {
        id: makeId("source-run"),
        sourceId: this.id,
        status: records.length ? "complete" : "no_results",
        startedAt: context.retrievedAt,
        completedAt: new Date().toISOString(),
        resultCount: records.length,
        message: records.length
          ? `${records.length} public scientific and technical information results from NASA NTRS.`
          : "No NASA NTRS records matched this query."
      },
      rawRecords: rawResults.map((payloadRecord, index) => ({
        id: makeId("raw-ntrs", `${context.retrievedAt}|${index}`),
        sourceId: this.id,
        retrievalTimestamp: context.retrievedAt,
        payload: payloadRecord
      })),
      records,
      warnings: [
        "NTRS is NASA's public scientific and technical information repository, not a unified NASA FOIA reading room.",
        "A public NTRS result does not, by itself, establish a declassification or full-release determination."
      ]
    };
  }

  normalize(raw: NtrsResult, query: NormalizedSearchQuery, context: AdapterContext): NormalizedRecord[] {
    const id = text(raw.id);
    if (!/^\d+$/.test(id)) return [];
    const officialUrl = `https://ntrs.nasa.gov/citations/${id}`;
    const title = text(raw.title) || `NASA NTRS record ${id}`;
    const authors = authorNames(raw.authorAffiliations);
    const subjects = Array.isArray(raw.subjectCategories) ? raw.subjectCategories.map(text).filter(Boolean) : [];
    const reportNumbers = [
      ...(Array.isArray(raw.otherReportNumbers) ? raw.otherReportNumbers.map(text) : []),
      text(raw.reportNumber)
    ].filter(Boolean);
    const downloads = Array.isArray(raw.downloads)
      ? raw.downloads.flatMap((download) =>
          officialDownloads(download as NtrsDownload, id)
        )
      : [];
    const publicationDate = Array.isArray(raw.publications)
      ? raw.publications
          .map((publication) =>
            publication && typeof publication === "object"
              ? text((publication as { publicationDate?: unknown }).publicationDate)
              : ""
          )
          .find(Boolean)
      : "";
    const date = normalizeDate(
      text(raw.publicationDate) || publicationDate || text(raw.distributionDate) || text(raw.submittedDate)
    );
    const primaryDownload =
      downloads.find((download) => download.mediaType === "application/pdf")?.downloadUrl ??
      downloads[0]?.downloadUrl;
    const record: NormalizedRecord = {
      id: makeId(this.id, id),
      title: sourced(title),
      date: date.iso ? sourced(date.iso) : undefined,
      datePrecision: sourced(date.precision, "Opstalia date normalization"),
      authorSender: authors.length ? sourced(authors) : undefined,
      documentType: text(raw.stiTypeDetails ?? raw.stiType) ? sourced(text(raw.stiTypeDetails ?? raw.stiType)) : undefined,
      subject: subjects.length ? sourced(subjects) : undefined,
      sourceRepository: sourced("NASA Technical Reports Server"),
      sourceCollection: sourced("Public scientific and technical information"),
      officialUrl: sourced(officialUrl),
      recordPageUrl: sourced(officialUrl),
      downloadUrl: primaryDownload ? sourced(primaryDownload) : undefined,
      documentNumber: reportNumbers.length ? sourced(reportNumbers.join("; ")) : sourced(id),
      digitizationStatus: sourced(downloads.length ? "Public download reported by NTRS" : "Metadata or abstract only"),
      ocrAvailability: sourced(downloads.some((download) => download.mediaType === "text/plain")),
      releaseStatus: {
        status: downloads.length ? "not_determined" : "metadata_only",
        determinationBasis: downloads.length
          ? "NTRS reports public distribution and a download, but it does not establish an agency declassification or full-release status"
          : "NTRS supplies public metadata without a downloadable object in this result",
        source: "NASA NTRS API and Opstalia cautious release-status policy",
        confidence: 0.95,
        humanReview: true
      },
      exemptionCodes: [],
      classificationMarkings: [],
      extractedIdentifiers: extractIdentifiers(`${id} ${reportNumbers.join(" ")} ${title}`),
      textSnippet: text(raw.abstract) ? sourced(text(raw.abstract).slice(0, 1200)) : undefined,
      digitalObjects: downloads,
      provenance: {
        adapterId: this.id,
        sourceId: this.id,
        officialDomain: "ntrs.nasa.gov",
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
      status: "healthy",
      checkedAt: new Date().toISOString(),
      message: "NASA NTRS has a documented public search API; a schema-validating search remains the operational health check."
    };
  }
}
