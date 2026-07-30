import type {
  NormalizedRecord,
  SearchTarget,
  SourceDefinition,
  SourcedValue
} from "../core/types";
import { extractIdentifiers } from "../analysis/identifiers";
import { normalizeDate } from "../analysis/date";
import { scoreRecord } from "../analysis/scoring";
import { makeId } from "../core/id";
import { sanitizePlainText } from "../core/validation";
import { validateResearcherRecordLocator } from "../security/url-policy";

export interface ManualOfficialRecordInput {
  title: string;
  officialUrl: string;
  date?: string;
  identifier?: string;
  note?: string;
}

function researcherValue<T>(value: T, source: string): SourcedValue<T> {
  return {
    value,
    source,
    extractionMethod: "researcher_confirmed",
    confidence: 1
  };
}

export function createManualOfficialRecord(
  source: SourceDefinition,
  target: SearchTarget,
  input: ManualOfficialRecordInput
): NormalizedRecord {
  const title = sanitizePlainText(input.title).slice(0, 500);
  const officialUrl = input.officialUrl.trim();
  if (!title) throw new Error("Enter the official record title.");
  const locator = validateResearcherRecordLocator(officialUrl, source);
  if (!locator.allowed) throw new Error(locator.reason);
  const parsedUrl = new URL(officialUrl);
  const enteredDate = sanitizePlainText(input.date ?? "").slice(0, 100);
  const date = normalizeDate(enteredDate);
  const identifier = sanitizePlainText(input.identifier ?? "").slice(0, 500);
  const note = sanitizePlainText(input.note ?? "").slice(0, 2000);
  const timestamp = new Date().toISOString();
  const sourceLabel = `Researcher entry from ${source.displayName}`;
  const record: NormalizedRecord = {
    id: makeId(`manual-${source.id}`, `${officialUrl}|${title}`),
    title: researcherValue(title, sourceLabel),
    date: enteredDate ? researcherValue(date.iso ?? enteredDate, sourceLabel) : undefined,
    datePrecision: enteredDate ? researcherValue(date.precision, "Opstalia date normalization") : undefined,
    originatingAgency: researcherValue(source.agency, "Opstalia source registry"),
    sourceRepository: researcherValue(source.displayName, "Opstalia source registry"),
    officialUrl: researcherValue(officialUrl, sourceLabel),
    recordPageUrl: researcherValue(officialUrl, sourceLabel),
    caseNumber: /\b(?:F|MDR)-?\d{4}-\d{3,6}/i.test(identifier)
      ? researcherValue(identifier, sourceLabel)
      : undefined,
    documentNumber: identifier && !/\b(?:F|MDR)-?\d{4}-\d{3,6}/i.test(identifier)
      ? researcherValue(identifier, sourceLabel)
      : undefined,
    releaseStatus: {
      status: "not_determined",
      determinationBasis: "Researcher recorded an official locator; release status has not been determined.",
      source: "researcher",
      confidence: 1,
      humanReview: true
    },
    exemptionCodes: [],
    classificationMarkings: [],
    extractedIdentifiers: extractIdentifiers(identifier),
    digitalObjects: [],
    provenance: {
      adapterId: source.id,
      sourceId: source.id,
      officialDomain: parsedUrl.hostname,
      officialRecordUrl: officialUrl,
      retrievalTimestamp: timestamp,
      normalizationVersion: "1.0.1-researcher-locator"
    },
    retrievalTimestamp: timestamp,
    confidenceScore: 0,
    matchExplanation: [],
    review: {
      disposition: "unreviewed",
      notes: note || undefined,
      basis: "Researcher confirmed this is an official, publicly released, unclassified locator.",
      updatedAt: timestamp
    }
  };
  const score = scoreRecord(record, target);
  record.confidenceScore = score.score;
  record.matchExplanation = score.factors;
  return record;
}
