import { z } from "zod";

const safeText = z
  .string()
  .trim()
  .max(500, "Each field is limited to 500 characters")
  .optional()
  .or(z.literal(""));
const notesText = z.string().trim().max(2000, "Search notes are limited to 2,000 characters").optional().or(z.literal(""));

const extractionMethodSchema = z.enum([
  "source_reported",
  "source_structured",
  "ocr",
  "pattern_match",
  "algorithmic_inference",
  "researcher_confirmed",
  "researcher_corrected"
]);

const queryKindSchema = z.enum([
  "exact_phrase",
  "broad_keyword",
  "name_variant",
  "acronym_expansion",
  "date_variant",
  "identifier",
  "agency_variant",
  "ocr_tolerant",
  "spelling_variant"
]);

const searchQuerySchema = z.object({
  id: z.string().min(1).max(100),
  label: z.string().min(1).max(100),
  text: z.string().trim().min(1).max(500),
  kind: queryKindSchema,
  enabled: z.boolean(),
  sourceIds: z.array(z.string().max(80)).max(40),
  explanation: z.string().max(300)
});

function sourcedValueSchema(valueSchema: z.ZodType) {
  return z.object({
    value: valueSchema,
    source: z.string().min(1).max(2048),
    extractionMethod: extractionMethodSchema,
    confidence: z.number().min(0).max(1),
    researcherOverride: z
      .object({
        value: valueSchema,
        basis: z.string().min(1).max(2000),
        timestamp: z.string().max(80)
      })
      .optional()
  });
}

export const searchTargetSchema = z
  .object({
    mode: z.enum(["guided", "quick"]),
    quickQuery: safeText,
    titleOrSubject: safeText,
    exactPhrase: safeText,
    generalKeywords: safeText,
    dateFrom: z.string().max(10).optional().or(z.literal("")),
    dateTo: z.string().max(10).optional().or(z.literal("")),
    originatingAgency: safeText,
    originatingOffice: safeText,
    authorSender: safeText,
    recipient: safeText,
    documentType: safeText,
    identifiers: safeText,
    geographicFocus: safeText,
    notes: notesText
  })
  .superRefine((target, context) => {
    const hasSearchText = Object.entries(target).some(
      ([key, value]) => key !== "mode" && key !== "notes" && typeof value === "string" && value.trim().length > 0
    );
    if (!hasSearchText) {
      context.addIssue({ code: "custom", message: "Enter at least one unclassified search term or identifier" });
    }
    if (target.dateFrom && target.dateTo && target.dateFrom > target.dateTo) {
      context.addIssue({ code: "custom", path: ["dateTo"], message: "End date must not precede start date" });
    }
  });

export const apiSearchRequestSchema = z.object({
  target: searchTargetSchema,
  query: searchQuerySchema,
  limit: z.number().int().min(1).max(50).default(20),
  cursor: z.string().max(300).optional(),
  privateMode: z.boolean().default(false)
});

const releaseStatusSchema = z.enum([
  "released_in_full",
  "released_in_part",
  "released_with_redactions_status_unclear",
  "metadata_only",
  "described_but_not_digitized",
  "withdrawal_notice_only",
  "finding_aid_only",
  "not_determined"
]);

const releaseDeterminationSchema = z
  .object({
    status: releaseStatusSchema,
    determinationBasis: z.string().max(2000),
    source: z.string().max(2048),
    confidence: z.number().min(0).max(1),
    humanReview: z.boolean()
  })
  .superRefine((determination, context) => {
    if (
      determination.status === "released_in_full" &&
      determination.source === "researcher" &&
      determination.determinationBasis.trim().length < 3
    ) {
      context.addIssue({
        code: "custom",
        path: ["determinationBasis"],
        message: "A researcher full-release determination requires a recorded basis"
      });
    }
  });

const releaseMarkingSchema = z.object({
  id: z.string().min(1).max(150),
  code: z.string().max(100).optional(),
  text: z.string().max(2000),
  system: z.string().max(300).optional(),
  page: z.number().int().positive().optional(),
  spanLength: z.enum(["known", "estimated", "unknown"]).optional(),
  confidence: z.number().min(0).max(1),
  detectionMethod: extractionMethodSchema,
  falsePositive: z.boolean().optional(),
  researcherNote: z.string().max(5000).optional()
});

const digitalObjectSchema = z.object({
  id: z.string().min(1).max(150),
  url: z.string().url().max(4096),
  downloadUrl: z.string().url().max(4096).optional(),
  thumbnailUrl: z.string().url().max(4096).optional(),
  mediaType: z.string().max(200).optional(),
  pageNumber: z.number().int().positive().optional(),
  ocrText: z.string().max(10_000_000).optional(),
  sizeBytes: z.number().int().nonnegative().optional()
});

const normalizedRecordSchema = z.object({
  id: z.string().min(1).max(200),
  title: sourcedValueSchema(z.string().max(20_000)),
  date: sourcedValueSchema(z.string().max(100)).optional(),
  datePrecision: sourcedValueSchema(z.enum(["day", "month", "year", "range", "unknown"])).optional(),
  originatingAgency: sourcedValueSchema(z.string().max(5000)).optional(),
  office: sourcedValueSchema(z.string().max(5000)).optional(),
  authorSender: sourcedValueSchema(z.array(z.string().max(1000)).max(500)).optional(),
  recipient: sourcedValueSchema(z.array(z.string().max(1000)).max(500)).optional(),
  documentType: sourcedValueSchema(z.string().max(1000)).optional(),
  subject: sourcedValueSchema(z.array(z.string().max(2000)).max(1000)).optional(),
  sourceRepository: sourcedValueSchema(z.string().max(2000)),
  sourceCollection: sourcedValueSchema(z.string().max(10_000)).optional(),
  officialUrl: sourcedValueSchema(z.string().url().max(4096)),
  downloadUrl: sourcedValueSchema(z.string().url().max(4096)).optional(),
  recordPageUrl: sourcedValueSchema(z.string().url().max(4096)),
  thumbnailUrl: sourcedValueSchema(z.string().url().max(4096)).optional(),
  naraNaid: sourcedValueSchema(z.string().max(100)).optional(),
  archivalCitation: sourcedValueSchema(z.string().max(20_000)).optional(),
  caseNumber: sourcedValueSchema(z.string().max(1000)).optional(),
  documentNumber: sourcedValueSchema(z.string().max(1000)).optional(),
  pageCount: sourcedValueSchema(z.number().int().nonnegative()).optional(),
  digitizationStatus: sourcedValueSchema(z.string().max(2000)).optional(),
  ocrAvailability: sourcedValueSchema(z.boolean()).optional(),
  releaseDate: sourcedValueSchema(z.string().max(100)).optional(),
  releaseMechanism: sourcedValueSchema(z.string().max(2000)).optional(),
  releaseAuthority: sourcedValueSchema(z.string().max(2000)).optional(),
  releaseStatus: releaseDeterminationSchema,
  exemptionCodes: z.array(z.string().max(100)).max(500),
  classificationMarkings: z.array(releaseMarkingSchema).max(10_000),
  extractedIdentifiers: z.array(z.string().max(1000)).max(10_000),
  textSnippet: sourcedValueSchema(z.string().max(100_000)).optional(),
  digitalObjects: z.array(digitalObjectSchema).max(10_000),
  provenance: z.object({
    adapterId: z.string().min(1).max(100),
    sourceId: z.string().min(1).max(100),
    officialDomain: z.string().min(1).max(300),
    officialRecordUrl: z.string().url().max(4096),
    retrievalTimestamp: z.string().max(80),
    rawRecordId: z.string().max(200).optional(),
    normalizationVersion: z.string().min(1).max(100),
    fixture: z.boolean().optional(),
    importedUnverified: z.boolean().optional()
  }),
  retrievalTimestamp: z.string().max(80),
  confidenceScore: z.number().min(0).max(100),
  matchExplanation: z
    .array(
      z.object({
        label: z.string().max(500),
        points: z.number().min(-100).max(100),
        detail: z.string().max(5000)
      })
    )
    .max(500),
  review: z.object({
    disposition: z.enum(["unreviewed", "confirmed_match", "rejected_match"]),
    releaseStatusOverride: releaseDeterminationSchema.optional(),
    correctedFields: z.record(z.string(), z.unknown()).optional(),
    basis: z.string().max(5000).optional(),
    notes: z.string().max(20_000).optional(),
    bestAvailablePublicCopy: z.boolean().optional(),
    unresolvedQuestions: z.array(z.string().max(5000)).max(1000).optional(),
    updatedAt: z.string().max(80).optional()
  })
});

const sourceRunSchema = z.object({
  id: z.string().min(1).max(200),
  sourceId: z.string().min(1).max(100),
  status: z.enum([
    "waiting",
    "searching",
    "complete",
    "no_results",
    "temporarily_unavailable",
    "blocked",
    "manual_available",
    "cancelled"
  ]),
  startedAt: z.string().max(80).optional(),
  completedAt: z.string().max(80).optional(),
  resultCount: z.number().int().nonnegative(),
  message: z.string().max(5000).optional(),
  manualSearchUrl: z.string().url().max(4096).optional(),
  fromCache: z.boolean().optional()
});

const versionRelationshipSchema = z.object({
  id: z.string().min(1).max(200),
  leftRecordId: z.string().min(1).max(200),
  rightRecordId: z.string().min(1).max(200),
  label: z.enum([
    "confirmed_same_document",
    "probable_version",
    "possible_version",
    "related_record",
    "insufficient_evidence"
  ]),
  score: z.number().min(0).max(100),
  reasons: z.array(z.string().max(5000)).max(500),
  researcherOverride: z
    .object({
      label: z.enum([
        "confirmed_same_document",
        "probable_version",
        "possible_version",
        "related_record",
        "insufficient_evidence"
      ]),
      basis: z.string().min(1).max(5000),
      timestamp: z.string().max(80)
    })
    .optional()
});

export const projectImportSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(500),
  createdAt: z.string().max(80),
  updatedAt: z.string().max(80),
  target: searchTargetSchema,
  plan: z.object({
    id: z.string().min(1).max(200),
    createdAt: z.string().max(80),
    target: searchTargetSchema,
    queries: z.array(searchQuerySchema).max(100),
    sourceSelectionStrategy: z.array(z.string().max(1000)).max(100)
  }),
  sourceRuns: z.array(sourceRunSchema).max(500),
  rawRecords: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        sourceId: z.string().min(1).max(100),
        retrievalTimestamp: z.string().max(80),
        payload: z.unknown(),
        payloadHash: z.string().max(200).optional()
      })
    )
    .max(5000),
  records: z.array(normalizedRecordSchema).max(5000),
  savedRecordIds: z.array(z.string().max(200)).max(5000),
  versionGroups: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        label: z.string().min(1).max(1000),
        recordIds: z.array(z.string().max(200)).max(5000),
        relationships: z.array(versionRelationshipSchema).max(10_000),
        reviewStatus: z.enum(["awaiting_review", "confirmed", "split"]),
        bestAvailablePublicCopyId: z.string().max(200).optional(),
        notes: z.string().max(20_000).optional()
      })
    )
    .max(1000),
  comparisons: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        recordIds: z.array(z.string().max(200)).max(100),
        pageAlignment: z.record(z.string(), z.number().int().positive()),
        notes: z.string().max(20_000),
        createdAt: z.string().max(80),
        updatedAt: z.string().max(80)
      })
    )
    .max(1000),
  notes: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        body: z.string().max(20_000),
        recordId: z.string().max(200).optional(),
        versionGroupId: z.string().max(200).optional(),
        createdAt: z.string().max(80),
        updatedAt: z.string().max(80)
      })
    )
    .max(5000),
  auditEvents: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        timestamp: z.string().max(80),
        action: z.string().max(2000),
        subjectId: z.string().max(200).optional(),
        basis: z.string().max(5000).optional(),
        actor: z.enum(["opstalia", "researcher"])
      })
    )
    .max(10_000),
  privateMode: z.boolean(),
  fixture: z.boolean().optional()
});

export function sanitizePlainText(value: string): string {
  return value
    // Control characters are never meaningful in a user-supplied search field.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
