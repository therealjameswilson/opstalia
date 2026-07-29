export type Confidence = "low" | "medium" | "high";

export type ExtractionMethod =
  | "source_reported"
  | "source_structured"
  | "ocr"
  | "pattern_match"
  | "algorithmic_inference"
  | "researcher_confirmed"
  | "researcher_corrected";

export interface SourcedValue<T> {
  value: T;
  source: string;
  extractionMethod: ExtractionMethod;
  confidence: number;
  researcherOverride?: {
    value: T;
    basis: string;
    timestamp: string;
  };
}

export interface SearchTarget {
  mode: "guided" | "quick";
  quickQuery?: string;
  titleOrSubject?: string;
  exactPhrase?: string;
  generalKeywords?: string;
  dateFrom?: string;
  dateTo?: string;
  originatingAgency?: string;
  originatingOffice?: string;
  authorSender?: string;
  recipient?: string;
  documentType?: string;
  identifiers?: string;
  geographicFocus?: string;
  notes?: string;
}

export type QueryKind =
  | "exact_phrase"
  | "broad_keyword"
  | "name_variant"
  | "acronym_expansion"
  | "date_variant"
  | "identifier"
  | "agency_variant"
  | "ocr_tolerant"
  | "spelling_variant";

export interface SearchQuery {
  id: string;
  label: string;
  text: string;
  kind: QueryKind;
  enabled: boolean;
  sourceIds: string[];
  explanation: string;
}

export interface SearchPlan {
  id: string;
  createdAt: string;
  target: SearchTarget;
  queries: SearchQuery[];
  sourceSelectionStrategy: string[];
}

export interface NormalizedSearchQuery {
  target: SearchTarget;
  query: SearchQuery;
  limit: number;
  cursor?: string;
  privateMode: boolean;
}

export type SourceCapability = "automated" | "manual" | "planned";
export type AdapterStatus =
  | "integrated"
  | "beta"
  | "manual"
  | "temporarily_unavailable"
  | "planned"
  | "retired";

export interface SourceDefinition {
  id: string;
  displayName: string;
  agency: string;
  officialDomains: string[];
  description: string;
  searchCapability: SourceCapability;
  apiAvailability: string;
  authentication: string;
  rateLimit: string;
  robotsAndTerms: string;
  adapterStatus: AdapterStatus;
  implementationMethod: string;
  supportedFilters: string[];
  fieldsReturned: string[];
  knownLimitations: string[];
  manualSearchUrl: string;
  lastValidated: string;
  enabledByDefault: boolean;
}

export type SourceRunStatus =
  | "waiting"
  | "searching"
  | "complete"
  | "no_results"
  | "temporarily_unavailable"
  | "blocked"
  | "manual_available"
  | "cancelled";

export interface SourceRun {
  id: string;
  sourceId: string;
  status: SourceRunStatus;
  startedAt?: string;
  completedAt?: string;
  resultCount: number;
  message?: string;
  manualSearchUrl?: string;
  fromCache?: boolean;
}

export interface RawSourceRecord {
  id: string;
  sourceId: string;
  retrievalTimestamp: string;
  payload: unknown;
  payloadHash?: string;
}

export type ReleaseStatus =
  | "released_in_full"
  | "released_in_part"
  | "released_with_redactions_status_unclear"
  | "metadata_only"
  | "described_but_not_digitized"
  | "withdrawal_notice_only"
  | "finding_aid_only"
  | "not_determined";

export interface ReleaseDetermination {
  status: ReleaseStatus;
  determinationBasis: string;
  source: string;
  confidence: number;
  humanReview: boolean;
}

export interface ReleaseEvent {
  date?: SourcedValue<string>;
  authority?: SourcedValue<string>;
  mechanism?: SourcedValue<string>;
  status: ReleaseDetermination;
}

export interface ReleaseMarking {
  id: string;
  code?: string;
  text: string;
  system?: string;
  page?: number;
  spanLength?: "known" | "estimated" | "unknown";
  confidence: number;
  detectionMethod: ExtractionMethod;
  falsePositive?: boolean;
  researcherNote?: string;
}

export interface DigitalObject {
  id: string;
  url: string;
  downloadUrl?: string;
  thumbnailUrl?: string;
  mediaType?: string;
  pageNumber?: number;
  ocrText?: string;
  sizeBytes?: number;
}

export type ReviewDisposition = "unreviewed" | "confirmed_match" | "rejected_match";

export interface ResearchReview {
  disposition: ReviewDisposition;
  releaseStatusOverride?: ReleaseDetermination;
  correctedFields?: Record<string, unknown>;
  basis?: string;
  notes?: string;
  bestAvailablePublicCopy?: boolean;
  unresolvedQuestions?: string[];
  updatedAt?: string;
}

export interface ProvenanceRecord {
  adapterId: string;
  sourceId: string;
  officialDomain: string;
  officialRecordUrl: string;
  retrievalTimestamp: string;
  rawRecordId?: string;
  normalizationVersion: string;
  fixture?: boolean;
  importedUnverified?: boolean;
}

export interface NormalizedRecord {
  id: string;
  title: SourcedValue<string>;
  date?: SourcedValue<string>;
  datePrecision?: SourcedValue<"day" | "month" | "year" | "range" | "unknown">;
  originatingAgency?: SourcedValue<string>;
  office?: SourcedValue<string>;
  authorSender?: SourcedValue<string[]>;
  recipient?: SourcedValue<string[]>;
  documentType?: SourcedValue<string>;
  subject?: SourcedValue<string[]>;
  sourceRepository: SourcedValue<string>;
  sourceCollection?: SourcedValue<string>;
  officialUrl: SourcedValue<string>;
  downloadUrl?: SourcedValue<string>;
  recordPageUrl: SourcedValue<string>;
  thumbnailUrl?: SourcedValue<string>;
  naraNaid?: SourcedValue<string>;
  archivalCitation?: SourcedValue<string>;
  caseNumber?: SourcedValue<string>;
  documentNumber?: SourcedValue<string>;
  pageCount?: SourcedValue<number>;
  digitizationStatus?: SourcedValue<string>;
  ocrAvailability?: SourcedValue<boolean>;
  releaseDate?: SourcedValue<string>;
  releaseMechanism?: SourcedValue<string>;
  releaseAuthority?: SourcedValue<string>;
  releaseStatus: ReleaseDetermination;
  exemptionCodes: string[];
  classificationMarkings: ReleaseMarking[];
  extractedIdentifiers: string[];
  textSnippet?: SourcedValue<string>;
  digitalObjects: DigitalObject[];
  provenance: ProvenanceRecord;
  retrievalTimestamp: string;
  confidenceScore: number;
  matchExplanation: ScoreFactor[];
  review: ResearchReview;
}

export interface ScoreFactor {
  label: string;
  points: number;
  detail: string;
}

export type VersionRelationshipLabel =
  | "confirmed_same_document"
  | "probable_version"
  | "possible_version"
  | "related_record"
  | "insufficient_evidence";

export interface VersionRelationship {
  id: string;
  leftRecordId: string;
  rightRecordId: string;
  label: VersionRelationshipLabel;
  score: number;
  reasons: string[];
  researcherOverride?: {
    label: VersionRelationshipLabel;
    basis: string;
    timestamp: string;
  };
}

export interface VersionGroup {
  id: string;
  label: string;
  recordIds: string[];
  relationships: VersionRelationship[];
  reviewStatus: "awaiting_review" | "confirmed" | "split";
  bestAvailablePublicCopyId?: string;
  notes?: string;
}

export interface Comparison {
  id: string;
  recordIds: string[];
  pageAlignment: Record<string, number>;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchNote {
  id: string;
  body: string;
  recordId?: string;
  versionGroupId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  action: string;
  subjectId?: string;
  basis?: string;
  actor: "opstalia" | "researcher";
}

export interface SearchProject {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  target: SearchTarget;
  plan: SearchPlan;
  sourceRuns: SourceRun[];
  rawRecords: RawSourceRecord[];
  records: NormalizedRecord[];
  savedRecordIds: string[];
  versionGroups: VersionGroup[];
  comparisons: Comparison[];
  notes: ResearchNote[];
  auditEvents: AuditEvent[];
  privateMode: boolean;
  fixture?: boolean;
}

export interface SourceSearchResponse {
  sourceRun: SourceRun;
  rawRecords: RawSourceRecord[];
  records: NormalizedRecord[];
  warnings: string[];
}

export interface SourceHealth {
  sourceId: string;
  status: "healthy" | "degraded" | "unavailable" | "manual";
  checkedAt: string;
  secretConfigured?: boolean;
  message: string;
}

export interface ExportReport {
  generatedAt: string;
  project: SearchProject;
  bestCandidateId?: string;
  caveats: string[];
  factLegend: Record<string, string>;
}

export interface ExemptionCode {
  code: string;
  aliases: string[];
  system: string;
  shortDefinition: string;
  detailedDefinition: string;
  authority: string;
  officialCitationUrl: string;
  lastVerified: string;
  notes: string;
  interpretationVariesByAgency: boolean;
}
