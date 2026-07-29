import type {
  NormalizedRecord,
  NormalizedSearchQuery,
  RawSourceRecord,
  SourceRun,
  SourceSearchResponse,
  SourcedValue
} from "../core/types";
import { makeId } from "../core/id";
import { extractIdentifiers } from "../analysis/identifiers";
import { normalizeDate } from "../analysis/date";
import { scoreRecord } from "../analysis/scoring";
import { determineReleaseStatus } from "../analysis/release-status";
import { validatePrimaryEvidence } from "../security/url-policy";
import { getSource } from "../data/registry";

type IndexName = "frus" | "iscap" | "ndc";
const indexCache = new Map<IndexName, unknown>();

function sourced<T>(value: T, source: string, confidence = 0.95): SourcedValue<T> {
  return { value, source, extractionMethod: "source_structured", confidence };
}

function searchTokens(value: string): string[] {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function matches(recordText: string, queryText: string, exact = false): boolean {
  const haystack = recordText.toLocaleLowerCase();
  const phrase = queryText.replaceAll('"', "").trim().toLocaleLowerCase();
  if (exact || queryText.includes('"')) return haystack.includes(phrase);
  const terms = searchTokens(queryText);
  if (!terms.length) return false;
  const hits = terms.filter((term) => haystack.includes(term)).length;
  return hits >= Math.max(1, Math.ceil(terms.length * 0.55));
}

async function loadIndex<T>(name: IndexName, signal?: AbortSignal): Promise<T> {
  if (indexCache.has(name)) return indexCache.get(name) as T;
  const url = `${import.meta.env.BASE_URL}data/indexes/${name}.json`;
  const response = await fetch(url, { signal, credentials: "same-origin" });
  if (!response.ok) throw new Error(`Local ${name.toUpperCase()} index returned ${response.status}`);
  const data = (await response.json()) as T;
  indexCache.set(name, data);
  return data;
}

function finish(
  sourceId: string,
  startedAt: string,
  records: NormalizedRecord[],
  rawRecords: RawSourceRecord[],
  warnings: string[]
): SourceSearchResponse {
  const source = getSource(sourceId);
  const filtered = records.filter((record) => {
    if (!source) return false;
    return validatePrimaryEvidence(record.officialUrl.value, record.provenance, source).allowed;
  });
  const sourceRun: SourceRun = {
    id: makeId("source-run"),
    sourceId,
    status: filtered.length ? "complete" : "no_results",
    startedAt,
    completedAt: new Date().toISOString(),
    resultCount: filtered.length,
    message: filtered.length ? `${filtered.length} official records matched the local source index.` : "No indexed records matched."
  };
  return { sourceRun, records: filtered, rawRecords, warnings };
}

interface FrusIndexRecord {
  id: string;
  volumeId: string;
  documentId: string;
  documentNumber: string;
  title: string;
  volumeTitle: string;
  date: string;
  dateDisplay: string;
  persons: string[];
  repository: string;
  collection: string;
  archivalIdentifier: string;
  documentType: string;
  authors: string[];
  recipients: string[];
  sourceNote: string;
  snippet: string;
  officialUrl: string;
  sourcePath: string;
}

export async function searchFrus(query: NormalizedSearchQuery, signal?: AbortSignal): Promise<SourceSearchResponse> {
  const startedAt = new Date().toISOString();
  const index = await loadIndex<{ commit: string; coverage: string[]; limitations: string[]; records: FrusIndexRecord[] }>("frus", signal);
  const raw = index.records
    .filter((record) =>
      matches(
        [
          record.title,
          record.volumeTitle,
          record.date,
          record.dateDisplay,
          record.persons.join(" "),
          record.repository,
          record.collection,
          record.archivalIdentifier,
          record.documentType,
          record.sourceNote,
          record.snippet
        ].join(" "),
        query.query.text,
        query.query.kind === "exact_phrase"
      )
    )
    .slice(0, query.limit);
  const retrievalTimestamp = new Date().toISOString();
  const rawRecords: RawSourceRecord[] = raw.map((record) => ({
    id: makeId("raw-frus", record.id),
    sourceId: "frus",
    retrievalTimestamp,
    payload: record
  }));
  const records = raw.map((record, indexPosition) => {
    const normalizedDate = normalizeDate(record.date || record.dateDisplay);
    const releaseStatus = determineReleaseStatus({ hasDigitalObject: true }, "Office of the Historian TEI");
    const normalized: NormalizedRecord = {
      id: makeId("frus", record.id),
      title: sourced(record.title, "Office of the Historian TEI"),
      date: normalizedDate.iso ? sourced(normalizedDate.iso, "Office of the Historian TEI") : undefined,
      datePrecision: sourced(normalizedDate.precision, "Opstalia date normalization", 0.9),
      originatingAgency: record.repository ? sourced(record.repository, "FRUS source note") : undefined,
      authorSender: record.authors.length ? sourced(record.authors, "Office of the Historian TEI") : undefined,
      recipient: record.recipients.length ? sourced(record.recipients, "Office of the Historian TEI") : undefined,
      documentType: record.documentType ? sourced(record.documentType, "Office of the Historian TEI") : undefined,
      subject: record.persons.length ? sourced(record.persons.slice(0, 12), "Office of the Historian TEI person index") : undefined,
      sourceRepository: sourced("Foreign Relations of the United States", "Office of the Historian"),
      sourceCollection: sourced(record.volumeTitle, "Office of the Historian TEI"),
      officialUrl: sourced(record.officialUrl, "Office of the Historian TEI"),
      recordPageUrl: sourced(record.officialUrl, "Office of the Historian TEI"),
      archivalCitation: record.sourceNote ? sourced(record.sourceNote, "FRUS source note") : undefined,
      documentNumber: record.documentNumber ? sourced(record.documentNumber, "Office of the Historian TEI") : undefined,
      digitizationStatus: sourced("Official born-digital publication text", "Office of the Historian TEI"),
      ocrAvailability: sourced(true, "Structured TEI text"),
      releaseMechanism: sourced("Official edited documentary publication", "Office of the Historian"),
      releaseStatus,
      exemptionCodes: [],
      classificationMarkings: [],
      extractedIdentifiers: extractIdentifiers(`${record.archivalIdentifier} ${record.sourceNote}`),
      textSnippet: sourced(record.snippet, "Office of the Historian TEI"),
      digitalObjects: [],
      provenance: {
        adapterId: "frus",
        sourceId: "frus",
        officialDomain: "history.state.gov",
        officialRecordUrl: record.officialUrl,
        retrievalTimestamp,
        rawRecordId: rawRecords[indexPosition].id,
        normalizationVersion: "1.0.0"
      },
      retrievalTimestamp,
      confidenceScore: 0,
      matchExplanation: [],
      review: { disposition: "unreviewed" }
    };
    const score = scoreRecord(normalized, query.target);
    normalized.confidenceScore = score.score;
    normalized.matchExplanation = score.factors;
    return normalized;
  });
  return finish("frus", startedAt, records, rawRecords, index.limitations);
}

interface IscapIndexRecord {
  id: string;
  title: string;
  groupTitle: string;
  documentDate: string;
  agency: string;
  archivalLocation: string;
  appealNumber: string;
  releaseDate: string;
  officialUrl: string;
  recordPageUrl: string;
  notificationOnly: boolean;
}

export async function searchIscap(query: NormalizedSearchQuery, signal?: AbortSignal): Promise<SourceSearchResponse> {
  const startedAt = new Date().toISOString();
  const index = await loadIndex<{ limitations: string[]; records: IscapIndexRecord[] }>("iscap", signal);
  const raw = index.records
    .filter((record) => matches(Object.values(record).join(" "), query.query.text, query.query.kind === "exact_phrase"))
    .slice(0, query.limit);
  const retrievalTimestamp = new Date().toISOString();
  const rawRecords: RawSourceRecord[] = raw.map((record) => ({
    id: makeId("raw-iscap", record.id),
    sourceId: "iscap",
    retrievalTimestamp,
    payload: record
  }));
  const records = raw.map((record, indexPosition) => {
    const date = normalizeDate(record.documentDate);
    const releaseDate = normalizeDate(record.releaseDate);
    const normalized: NormalizedRecord = {
      id: makeId("iscap", record.id),
      title: sourced(record.title, "ISCAP official releases table"),
      date: date.iso ? sourced(date.iso, "ISCAP official releases table") : undefined,
      datePrecision: sourced(date.precision, "Opstalia date normalization", 0.85),
      originatingAgency: record.agency ? sourced(record.agency, "ISCAP official releases table") : undefined,
      sourceRepository: sourced("ISCAP Releases", "National Archives"),
      sourceCollection: record.archivalLocation ? sourced(record.archivalLocation, "ISCAP official releases table") : undefined,
      officialUrl: sourced(record.officialUrl, "ISCAP official releases table"),
      downloadUrl: /\.pdf(?:$|\?)/i.test(record.officialUrl) ? sourced(record.officialUrl, "ISCAP official releases table") : undefined,
      recordPageUrl: sourced(record.recordPageUrl, "ISCAP official releases table"),
      caseNumber: sourced(record.appealNumber, "ISCAP official releases table"),
      releaseDate: releaseDate.iso ? sourced(releaseDate.iso, "ISCAP official releases table") : undefined,
      releaseMechanism: sourced("ISCAP declassification appeal release", "ISCAP official releases table"),
      releaseAuthority: sourced("Interagency Security Classification Appeals Panel", "ISCAP official releases table"),
      releaseStatus: determineReleaseStatus(
        record.notificationOnly ? { metadataOnly: true } : { hasDigitalObject: /\.pdf(?:$|\?)/i.test(record.officialUrl) },
        "ISCAP official releases table"
      ),
      exemptionCodes: [],
      classificationMarkings: [],
      extractedIdentifiers: [record.appealNumber, ...extractIdentifiers(record.title)],
      digitalObjects: /\.pdf(?:$|\?)/i.test(record.officialUrl)
        ? [{ id: makeId("object", record.officialUrl), url: record.officialUrl, downloadUrl: record.officialUrl, mediaType: "application/pdf" }]
        : [],
      provenance: {
        adapterId: "iscap",
        sourceId: "iscap",
        officialDomain: "archives.gov",
        officialRecordUrl: record.officialUrl,
        retrievalTimestamp,
        rawRecordId: rawRecords[indexPosition].id,
        normalizationVersion: "1.0.0"
      },
      retrievalTimestamp,
      confidenceScore: 0,
      matchExplanation: [],
      review: { disposition: "unreviewed" }
    };
    const score = scoreRecord(normalized, query.target);
    normalized.confidenceScore = score.score;
    normalized.matchExplanation = score.factors;
    return normalized;
  });
  return finish("iscap", startedAt, records, rawRecords, index.limitations);
}

interface NdcIndexRecord {
  id: string;
  title: string;
  fields: Record<string, string>;
  searchableText: string;
  officialUrl: string;
  recordPageUrl: string;
  releaseStatus: "finding_aid_only" | "described_but_not_digitized";
}

export async function searchNdc(query: NormalizedSearchQuery, signal?: AbortSignal): Promise<SourceSearchResponse> {
  const startedAt = new Date().toISOString();
  const index = await loadIndex<{ releaseQuarter: string; limitations: string[]; records: NdcIndexRecord[] }>("ndc", signal);
  const raw = index.records
    .filter((record) => matches(record.searchableText, query.query.text, query.query.kind === "exact_phrase"))
    .slice(0, query.limit);
  const retrievalTimestamp = new Date().toISOString();
  const rawRecords: RawSourceRecord[] = raw.map((record) => ({
    id: makeId("raw-ndc", record.id),
    sourceId: "ndc",
    retrievalTimestamp,
    payload: record
  }));
  const records = raw.map((record, indexPosition) => {
    const normalized: NormalizedRecord = {
      id: makeId("ndc", record.id),
      title: sourced(record.title, `NDC ${index.releaseQuarter} release list`),
      sourceRepository: sourced("National Declassification Center Release Lists", "National Archives"),
      sourceCollection: sourced(index.releaseQuarter, "NDC official workbook"),
      officialUrl: sourced(record.officialUrl, "NDC official workbook"),
      recordPageUrl: sourced(record.recordPageUrl, "NDC official page"),
      archivalCitation: sourced(
        Object.entries(record.fields)
          .filter(([, value]) => value)
          .map(([key, value]) => `${key}: ${value}`)
          .join("; "),
        "NDC official workbook"
      ),
      releaseStatus: {
        status: record.releaseStatus,
        determinationBasis:
          record.releaseStatus === "described_but_not_digitized"
            ? "The official NDC list says the material is not available online"
            : "The NDC row is series-level release-list metadata rather than an item-level public copy",
        source: "NDC official workbook",
        confidence: 0.9,
        humanReview: true
      },
      exemptionCodes: [],
      classificationMarkings: [],
      extractedIdentifiers: extractIdentifiers(record.searchableText),
      textSnippet: sourced(record.searchableText.slice(0, 1200), "NDC official workbook"),
      digitalObjects: [],
      provenance: {
        adapterId: "ndc",
        sourceId: "ndc",
        officialDomain: "archives.gov",
        officialRecordUrl: record.officialUrl,
        retrievalTimestamp,
        rawRecordId: rawRecords[indexPosition].id,
        normalizationVersion: "1.0.0"
      },
      retrievalTimestamp,
      confidenceScore: 0,
      matchExplanation: [],
      review: { disposition: "unreviewed" }
    };
    const score = scoreRecord(normalized, query.target);
    normalized.confidenceScore = score.score;
    normalized.matchExplanation = score.factors;
    return normalized;
  });
  return finish("ndc", startedAt, records, rawRecords, index.limitations);
}
