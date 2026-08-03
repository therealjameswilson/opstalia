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
import { assertSafeOutboundUrl } from "../../../src/security/url-policy";
import type { AdapterContext, SourceAdapter } from "./types";
import { readBoundedJsonResponse } from "./http";

const OSTI_ENDPOINT = "https://www.osti.gov/api/v1/records";
const OSTI_ALLOWED_HOSTS = ["osti.gov"];
const MAX_OSTI_RESPONSE_BYTES = 5_000_000;

interface OstiLink {
  rel?: unknown;
  href?: unknown;
}

interface OstiResult {
  osti_id?: unknown;
  title?: unknown;
  description?: unknown;
  publication_date?: unknown;
  product_type?: unknown;
  authors?: unknown;
  subjects?: unknown;
  research_orgs?: unknown;
  sponsor_orgs?: unknown;
  report_number?: unknown;
  identifier?: unknown;
  other_identifiers?: unknown;
  links?: unknown;
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
    : "";
}

function array(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : text(value) ? [text(value)] : [];
}

function sourced<T>(value: T, source = "OSTI.GOV public API"): SourcedValue<T> {
  return { value, source, extractionMethod: "source_structured", confidence: 0.95 };
}

function boundOstiLink(
  value: unknown,
  ostiId: string,
  kind: "citation" | "fulltext"
): string | undefined {
  const candidate = text(value);
  try {
    const parsed = assertSafeOutboundUrl(candidate, OSTI_ALLOWED_HOSTS);
    const expectedPath =
      kind === "citation"
        ? `/biblio/${ostiId}`
        : `/servlets/purl/${ostiId}`;
    if (parsed.pathname.replace(/\/$/, "") !== expectedPath) return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

export class OstiAdapter implements SourceAdapter<OstiResult> {
  readonly id = "osti-sti";
  readonly name = "OSTI.GOV Scientific and Technical Information";

  async search(query: NormalizedSearchQuery, context: AdapterContext): Promise<SourceSearchResponse> {
    const upstream = assertSafeOutboundUrl(OSTI_ENDPOINT, OSTI_ALLOWED_HOSTS);
    upstream.searchParams.set("q", query.query.text);
    upstream.searchParams.set("rows", String(Math.min(query.limit, 50)));
    upstream.searchParams.set("page", query.cursor && /^\d+$/.test(query.cursor) ? query.cursor : "1");
    if (query.target.titleOrSubject) upstream.searchParams.set("title", query.target.titleOrSubject);
    if (query.target.authorSender) upstream.searchParams.set("author", query.target.authorSender);
    if (query.target.identifiers) upstream.searchParams.set("identifier", query.target.identifiers);
    if (query.target.dateFrom) upstream.searchParams.set("publication_date_start", query.target.dateFrom);
    if (query.target.dateTo) upstream.searchParams.set("publication_date_end", query.target.dateTo);

    const response = await fetch(upstream, {
      headers: { Accept: "application/json", "User-Agent": "Opstalia/1.0 official records research" },
      redirect: "manual",
      signal: context.signal,
      cf: { cacheTtl: 0, cacheEverything: false }
    } as RequestInit & { cf: { cacheTtl: number; cacheEverything: boolean } });
    if (!response.ok) {
      throw new Error(
        response.status === 429 ? "OSTI.GOV rate limit reached (429)" : `OSTI.GOV API returned ${response.status}`
      );
    }
    const payload = await readBoundedJsonResponse(
      response,
      "OSTI.GOV",
      MAX_OSTI_RESPONSE_BYTES
    );
    if (!Array.isArray(payload)) throw new Error("OSTI.GOV response did not match its documented result schema");
    const rawResults = payload as OstiResult[];
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
          ? `${records.length} public scientific and technical information results from OSTI.GOV.`
          : "No OSTI.GOV records matched this query."
      },
      rawRecords: rawResults.map((payloadRecord, index) => ({
        id: makeId("raw-osti", `${context.retrievedAt}|${index}`),
        sourceId: this.id,
        retrievalTimestamp: context.retrievedAt,
        payload: payloadRecord
      })),
      records,
      warnings: [
        "OSTI.GOV searches DOE-funded scientific and technical information. It is not the DOE OpenNet declassified-records corpus.",
        "A public OSTI result does not, by itself, establish a declassification or full-release determination."
      ]
    };
  }

  normalize(raw: OstiResult, query: NormalizedSearchQuery, context: AdapterContext): NormalizedRecord[] {
    const id = text(raw.osti_id);
    if (!/^\d+$/.test(id)) return [];
    const links = Array.isArray(raw.links) ? (raw.links as OstiLink[]) : [];
    const citationUrl =
      links.find((link) => text(link.rel) === "citation")?.href ?? `https://www.osti.gov/biblio/${id}`;
    const officialUrl = boundOstiLink(citationUrl, id, "citation");
    if (!officialUrl) return [];
    const fullTextUrl = boundOstiLink(
      links.find((link) => text(link.rel) === "fulltext")?.href,
      id,
      "fulltext"
    );
    const title = text(raw.title) || `OSTI record ${id}`;
    const authors = array(raw.authors);
    const subjects = array(raw.subjects);
    const reportNumbers = [
      text(raw.report_number),
      text(raw.identifier),
      ...array(raw.other_identifiers)
    ].filter(Boolean);
    const date = normalizeDate(text(raw.publication_date));
    const digitalObjects: DigitalObject[] = fullTextUrl
      ? [{ id: makeId("osti-object", fullTextUrl), url: fullTextUrl, downloadUrl: fullTextUrl }]
      : [];
    const record: NormalizedRecord = {
      id: makeId(this.id, id),
      title: sourced(title),
      date: date.iso ? sourced(date.iso) : undefined,
      datePrecision: sourced(date.precision, "Opstalia date normalization"),
      authorSender: authors.length ? sourced(authors) : undefined,
      originatingAgency: array(raw.sponsor_orgs).length ? sourced(array(raw.sponsor_orgs).join("; ")) : undefined,
      office: array(raw.research_orgs).length ? sourced(array(raw.research_orgs).join("; ")) : undefined,
      documentType: text(raw.product_type) ? sourced(text(raw.product_type)) : undefined,
      subject: subjects.length ? sourced(subjects) : undefined,
      sourceRepository: sourced("OSTI.GOV"),
      sourceCollection: sourced("DOE-funded public scientific and technical information"),
      officialUrl: sourced(officialUrl),
      recordPageUrl: sourced(officialUrl),
      downloadUrl: fullTextUrl ? sourced(fullTextUrl) : undefined,
      documentNumber: reportNumbers.length ? sourced(reportNumbers.join("; ")) : sourced(id),
      digitizationStatus: sourced(fullTextUrl ? "Public full-text link reported" : "Citation or metadata record"),
      ocrAvailability: sourced(false),
      releaseStatus: {
        status: fullTextUrl ? "not_determined" : "metadata_only",
        determinationBasis: fullTextUrl
          ? "OSTI reports public full text, but this STI record does not establish a declassification or full-release status"
          : "OSTI supplies a public citation without a reported full-text object",
        source: "OSTI.GOV API and Opstalia cautious release-status policy",
        confidence: 0.95,
        humanReview: true
      },
      exemptionCodes: [],
      classificationMarkings: [],
      extractedIdentifiers: extractIdentifiers(`${id} ${reportNumbers.join(" ")} ${title}`),
      textSnippet: text(raw.description) ? sourced(text(raw.description).slice(0, 1200)) : undefined,
      digitalObjects,
      provenance: {
        adapterId: this.id,
        sourceId: this.id,
        officialDomain: new URL(officialUrl).hostname,
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
      message: "OSTI.GOV has a documented public records API; a schema-validating search remains the operational health check."
    };
  }
}
