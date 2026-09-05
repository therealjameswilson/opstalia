import { strToU8, zipSync } from "fflate";
import type {
  PdfPacketProject,
  PdfPacketSegment,
  PdfPacketSegmentKind
} from "../core/types";
import { safeCsvCell, safeMarkdownText, safeMarkdownUrl } from "./export-safety";

export const MAX_BATCH_DERIVATIVES = 200;
export const MAX_BATCH_SELECTED_PAGES = 5_000;

export type BatchPreflightIssueCode =
  | "invalid_range"
  | "out_of_bounds"
  | "exact_duplicate"
  | "overlap"
  | "uncovered_source_gap"
  | "derivative_limit_exceeded"
  | "page_limit_exceeded";

export interface BatchPreflightIssue {
  code: BatchPreflightIssueCode;
  severity: "error" | "warning" | "information";
  message: string;
  segmentIds: string[];
  startPage?: number;
  endPage?: number;
}

export interface BatchDerivativePlanItem {
  segmentId: string;
  title: string;
  startPage: number;
  endPage: number;
  pageCount: number;
  fileName: string;
  date?: string;
  documentType?: string;
  identifier?: string;
}

export interface BatchManifestOnlyItem {
  segmentId: string;
  kind: Extract<PdfPacketSegmentKind, "described_item">;
  title: string;
  evidencePages: number[];
  describedExtent?: number;
  reviewStatus: PdfPacketSegment["reviewStatus"];
  releaseStatus: PdfPacketSegment["releaseStatus"]["status"];
}

export interface BatchExcludedPageRange {
  segmentId: string;
  title: string;
  reviewStatus: PdfPacketSegment["reviewStatus"];
  reason: string;
}

export interface BatchExportPlan {
  sourcePageCount: number;
  selectedPageRangeCount: number;
  derivativeItems: BatchDerivativePlanItem[];
  manifestOnlyItems: BatchManifestOnlyItem[];
  excludedPageRanges: BatchExcludedPageRange[];
  totalSelectedPages: number;
  uniqueCoveredPages: number;
  uncoveredRanges: Array<{ startPage: number; endPage: number }>;
  issues: BatchPreflightIssue[];
  canExport: boolean;
}

export interface BatchDerivativeArtifact {
  segmentId: string;
  pdfBytes: Uint8Array;
  expectedSha256?: string;
}

export interface BatchPackagedFile {
  path: string;
  byteLength: number;
  sha256: string;
  kind: "derivative" | "manifest" | "register" | "readme" | "checksums";
}

export interface BatchResearchPacket {
  zipBytes: Uint8Array;
  plan: BatchExportPlan;
  files: BatchPackagedFile[];
}

export interface BatchExportOptions {
  maxDerivatives?: number;
  maxSelectedPages?: number;
  generatedAt?: string;
  selectedSegmentIds?: string[];
}

interface IndexedSegment {
  segment: PdfPacketSegment;
  originalIndex: number;
}

interface HashedDerivative extends BatchDerivativePlanItem {
  pdfBytes: Uint8Array;
  sha256: string;
}

function isReviewedPageRange(segment: PdfPacketSegment): boolean {
  return segment.kind === "page_range" && (
    segment.reviewStatus === "researcher_confirmed" ||
    segment.reviewStatus === "researcher_corrected"
  );
}

function rangeLabel(startPage: number, endPage: number): string {
  return startPage === endPage ? `page ${startPage}` : `pages ${startPage}-${endPage}`;
}

function safePart(value: string | undefined, fallback = ""): string {
  const normalized = (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
}

function numberedFileNames(
  items: Array<Omit<BatchDerivativePlanItem, "fileName">>,
  sourcePageCount: number
): string[] {
  const numberWidth = Math.max(3, String(items.length).length);
  const pageWidth = Math.max(4, String(sourcePageCount).length);
  const used = new Set<string>();
  return items.map((item, index) => {
    const sequence = String(index + 1).padStart(numberWidth, "0");
    const pageRange = `p${String(item.startPage).padStart(pageWidth, "0")}-p${String(item.endPage).padStart(pageWidth, "0")}`;
    const metadata = [
      /^\d{4}(?:-\d{2}){0,2}$/.test(item.date ?? "") ? item.date : undefined,
      safePart(item.documentType),
      safePart(item.identifier),
      safePart(item.title, "untitled-item")
    ].filter((value): value is string => Boolean(value));
    const core = metadata.join("_").slice(0, 145).replace(/[-_]+$/g, "") || "untitled-item";
    const base = `${sequence}_${core}_${pageRange}`;
    let candidate = `${base}.pdf`;
    let collision = 2;
    while (used.has(candidate.toLocaleLowerCase())) {
      candidate = `${base}-${collision}.pdf`;
      collision += 1;
    }
    used.add(candidate.toLocaleLowerCase());
    return candidate;
  });
}

function mergedRanges(
  items: Array<Pick<BatchDerivativePlanItem, "startPage" | "endPage">>
): Array<{ startPage: number; endPage: number }> {
  const merged: Array<{ startPage: number; endPage: number }> = [];
  for (const item of items) {
    const previous = merged.at(-1);
    if (!previous || item.startPage > previous.endPage + 1) {
      merged.push({ startPage: item.startPage, endPage: item.endPage });
      continue;
    }
    previous.endPage = Math.max(previous.endPage, item.endPage);
  }
  return merged;
}

function uncoveredSourceRanges(
  covered: Array<{ startPage: number; endPage: number }>,
  sourcePageCount: number
): Array<{ startPage: number; endPage: number }> {
  const gaps: Array<{ startPage: number; endPage: number }> = [];
  let nextPage = 1;
  for (const range of covered) {
    if (range.startPage > nextPage) {
      gaps.push({ startPage: nextPage, endPage: range.startPage - 1 });
    }
    nextPage = Math.max(nextPage, range.endPage + 1);
  }
  if (nextPage <= sourcePageCount) {
    gaps.push({ startPage: nextPage, endPage: sourcePageCount });
  }
  return gaps;
}

export function createBatchExportPlan(
  project: PdfPacketProject,
  options: Pick<BatchExportOptions, "maxDerivatives" | "maxSelectedPages" | "selectedSegmentIds"> = {}
): BatchExportPlan {
  const maxDerivatives = options.maxDerivatives ?? MAX_BATCH_DERIVATIVES;
  const maxSelectedPages = options.maxSelectedPages ?? MAX_BATCH_SELECTED_PAGES;
  if (!Number.isInteger(maxDerivatives) || maxDerivatives < 1) {
    throw new Error("The batch derivative limit must be a positive integer.");
  }
  if (!Number.isInteger(maxSelectedPages) || maxSelectedPages < 1) {
    throw new Error("The batch selected-page limit must be a positive integer.");
  }

  const indexed = project.segments.map((segment, originalIndex) => ({ segment, originalIndex }));
  const requestedIds = options.selectedSegmentIds === undefined
    ? undefined
    : new Set(options.selectedSegmentIds);
  const selected = indexed.filter(({ segment }) =>
    isReviewedPageRange(segment) && (requestedIds === undefined || requestedIds.has(segment.id))
  );
  const issues: BatchPreflightIssue[] = [];
  const valid: Array<IndexedSegment & { startPage: number; endPage: number }> = [];

  for (const item of selected) {
    const { segment } = item;
    const startPage = segment.startPage;
    const endPage = segment.endPage;
    if (
      !Number.isInteger(startPage) ||
      !Number.isInteger(endPage) ||
      startPage === undefined ||
      endPage === undefined ||
      endPage < startPage
    ) {
      issues.push({
        code: "invalid_range",
        severity: "error",
        message: `${segment.title} does not have a valid integer start-to-end page range.`,
        segmentIds: [segment.id]
      });
      continue;
    }
    if (startPage < 1 || endPage > project.source.pageCount) {
      issues.push({
        code: "out_of_bounds",
        severity: "error",
        message: `${segment.title} claims ${rangeLabel(startPage, endPage)}, outside this ${project.source.pageCount}-page source.`,
        segmentIds: [segment.id],
        startPage,
        endPage
      });
      continue;
    }
    valid.push({ ...item, startPage, endPage });
  }

  valid.sort((left, right) =>
    left.startPage - right.startPage ||
    left.endPage - right.endPage ||
    left.originalIndex - right.originalIndex
  );

  const withoutNames = valid.map(({ segment, startPage, endPage }) => ({
    segmentId: segment.id,
    title: segment.title,
    startPage,
    endPage,
    pageCount: endPage - startPage + 1,
    date: segment.date,
    documentType: segment.documentType,
    identifier: segment.identifier
  }));
  const names = numberedFileNames(withoutNames, project.source.pageCount);
  const derivativeItems: BatchDerivativePlanItem[] = withoutNames.map((item, index) => ({
    ...item,
    fileName: names[index]
  }));

  const duplicateRanges = new Map<string, BatchDerivativePlanItem[]>();
  for (const item of derivativeItems) {
    const key = `${item.startPage}:${item.endPage}`;
    duplicateRanges.set(key, [...(duplicateRanges.get(key) ?? []), item]);
  }
  for (const duplicates of duplicateRanges.values()) {
    if (duplicates.length < 2) continue;
    const [{ startPage, endPage }] = duplicates;
    issues.push({
      code: "exact_duplicate",
      severity: "warning",
      message: `${duplicates.length} reviewed items claim the exact same ${rangeLabel(startPage, endPage)}.`,
      segmentIds: duplicates.map((item) => item.segmentId),
      startPage,
      endPage
    });
  }

  for (let leftIndex = 0; leftIndex < derivativeItems.length; leftIndex += 1) {
    const left = derivativeItems[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < derivativeItems.length; rightIndex += 1) {
      const right = derivativeItems[rightIndex];
      if (right.startPage > left.endPage) break;
      if (left.startPage === right.startPage && left.endPage === right.endPage) continue;
      const startPage = Math.max(left.startPage, right.startPage);
      const endPage = Math.min(left.endPage, right.endPage);
      issues.push({
        code: "overlap",
        severity: "warning",
        message: `${left.title} and ${right.title} both include ${rangeLabel(startPage, endPage)}.`,
        segmentIds: [left.segmentId, right.segmentId],
        startPage,
        endPage
      });
    }
  }

  const covered = mergedRanges(derivativeItems);
  const uncoveredRanges = uncoveredSourceRanges(covered, project.source.pageCount);
  for (const gap of uncoveredRanges) {
    issues.push({
      code: "uncovered_source_gap",
      severity: "information",
      message: `No selected derivative covers source ${rangeLabel(gap.startPage, gap.endPage)}.`,
      segmentIds: [],
      ...gap
    });
  }

  const totalSelectedPages = derivativeItems.reduce((sum, item) => sum + item.pageCount, 0);
  const uniqueCoveredPages = covered.reduce((sum, range) => sum + range.endPage - range.startPage + 1, 0);
  if (selected.length > maxDerivatives) {
    issues.push({
      code: "derivative_limit_exceeded",
      severity: "error",
      message: `The batch selects ${selected.length} derivatives; the limit is ${maxDerivatives}.`,
      segmentIds: selected.map(({ segment }) => segment.id)
    });
  }
  if (totalSelectedPages > maxSelectedPages) {
    issues.push({
      code: "page_limit_exceeded",
      severity: "error",
      message: `The batch would copy ${totalSelectedPages.toLocaleString()} pages; the limit is ${maxSelectedPages.toLocaleString()}.`,
      segmentIds: derivativeItems.map((item) => item.segmentId)
    });
  }

  const manifestOnlyItems: BatchManifestOnlyItem[] = project.segments
    .filter((segment): segment is PdfPacketSegment & { kind: "described_item" } => segment.kind === "described_item")
    .map((segment) => ({
      segmentId: segment.id,
      kind: "described_item",
      title: segment.title,
      evidencePages: [...(segment.evidencePages ?? [])],
      describedExtent: segment.describedExtent,
      reviewStatus: segment.reviewStatus,
      releaseStatus: segment.releaseStatus.status
    }));
  const excludedPageRanges: BatchExcludedPageRange[] = project.segments
    .filter((segment) =>
      segment.kind === "page_range" && (
        !isReviewedPageRange(segment) ||
        (requestedIds !== undefined && !requestedIds.has(segment.id))
      )
    )
    .map((segment) => ({
      segmentId: segment.id,
      title: segment.title,
      reviewStatus: segment.reviewStatus,
      reason: isReviewedPageRange(segment)
        ? "Researcher-confirmed or corrected page range not selected for this batch"
        : segment.reviewStatus === "researcher_rejected"
          ? "Researcher-rejected page range"
          : "Page range has not been researcher-confirmed or corrected"
    }));

  return {
    sourcePageCount: project.source.pageCount,
    selectedPageRangeCount: selected.length,
    derivativeItems,
    manifestOnlyItems,
    excludedPageRanges,
    totalSelectedPages,
    uniqueCoveredPages,
    uncoveredRanges,
    issues,
    canExport: derivativeItems.length > 0 && !issues.some((issue) => issue.severity === "error")
  };
}

function batchRegisterCsv(
  project: PdfPacketProject,
  plan: BatchExportPlan,
  derivatives: HashedDerivative[]
): string {
  const bySegment = new Map(derivatives.map((item) => [item.segmentId, item]));
  const header = [
    "segment_id",
    "evidence_lane",
    "title",
    "pdf_start_page",
    "pdf_end_page",
    "evidence_pages",
    "described_extent",
    "date",
    "document_type",
    "identifier",
    "review_status",
    "release_status",
    "package_disposition",
    "derivative_file",
    "derivative_sha256",
    "source_sha256",
    "official_pdf_url",
    "official_record_url",
    "nara_naid"
  ];
  const rows = project.segments.map((segment) => {
    const derivative = bySegment.get(segment.id);
    const disposition = derivative
      ? "derivative_in_package"
      : segment.kind === "described_item"
        ? "manifest_only"
        : plan.excludedPageRanges.some((item) => item.segmentId === segment.id)
          ? "not_selected"
          : "invalid_selected_range";
    return [
      segment.id,
      segment.kind,
      segment.title,
      segment.startPage,
      segment.endPage,
      segment.evidencePages?.join(";"),
      segment.describedExtent,
      segment.date,
      segment.documentType,
      segment.identifier,
      segment.reviewStatus,
      segment.releaseStatus.status,
      disposition,
      derivative ? `documents/${derivative.fileName}` : "",
      derivative?.sha256,
      project.source.sha256,
      project.source.officialPdfUrl,
      project.source.officialRecordUrl,
      project.source.naraNaid
    ];
  });
  return [header, ...rows].map((row) => row.map(safeCsvCell).join(",")).join("\n") + "\n";
}

function packetReadme(
  project: PdfPacketProject,
  plan: BatchExportPlan,
  derivatives: HashedDerivative[],
  generatedAt: string
): string {
  const files = derivatives.map((item) =>
    `- \`documents/${item.fileName}\` - PDF pages ${item.startPage}-${item.endPage}; SHA-256 \`${item.sha256}\``
  );
  const manifestOnly = plan.manifestOnlyItems.map((item) =>
    `- ${safeMarkdownText(item.title)} - described item only; evidence PDF page${item.evidencePages.length === 1 ? "" : "s"} ${item.evidencePages.join(", ") || "not recorded"}; no derivative created.`
  );
  const warnings = plan.issues
    .filter((issue) => issue.severity !== "information")
    .map((issue) => `- ${safeMarkdownText(issue.message)}`);
  return [
    `# ${safeMarkdownText(project.name)} - Opstalia research packet`,
    "",
    "> Research derivatives are not official source files. Official source records and agency determinations control.",
    "",
    `Generated: ${generatedAt}`,
    `Official PDF: ${safeMarkdownUrl(project.source.officialPdfUrl)}`,
    `Researcher-supplied Catalog record: ${project.source.officialRecordUrl ? safeMarkdownUrl(project.source.officialRecordUrl) : "Not recorded"}`,
    `NARA NAID: ${project.source.naraNaid ?? "Not recorded"}`,
    `Official source SHA-256: ${project.source.sha256 ?? "Not recorded"}`,
    `Source PDF pages: ${project.source.pageCount}`,
    "",
    `This package contains ${derivatives.length} researcher-created derivative PDF${derivatives.length === 1 ? "" : "s"} covering ${plan.uniqueCoveredPages} unique source pages. The source PDF itself and its extracted text are not included.`,
    "",
    "## Derivative files",
    "",
    ...(files.length ? files : ["No derivative PDF was created."]),
    "",
    "## Described-only items",
    "",
    ...(manifestOnly.length ? manifestOnly : ["No described-only item was recorded."]),
    "",
    "## Preflight warnings",
    "",
    ...(warnings.length ? warnings : ["No overlap or duplicate warning was recorded."]),
    "",
    "## Caveats",
    "",
    "- Each derivative is a researcher-defined page-range convenience copy, not an official standalone release.",
    "- A more complete-looking copy is not necessarily authentic, complete, or released in full.",
    "- Described-only items identify source descriptions; they do not establish that the underlying content pages are present.",
    "- Annotation-bearing pages are refused because removing a covering annotation could reveal underlying text.",
    "- Confirm the researcher-supplied record-to-PDF association on the official NARA Catalog page.",
    "- SHA256SUMS.txt covers every packaged file except itself."
  ].join("\n") + "\n";
}

function batchManifest(
  project: PdfPacketProject,
  plan: BatchExportPlan,
  derivatives: HashedDerivative[],
  generatedAt: string
): Record<string, unknown> {
  return {
    schema: "opstalia-batch-research-packet/1.0",
    generatedAt,
    warning: "Research derivatives are not official source files. Official source records and agency determinations control.",
    officialSource: {
      sourceId: project.source.sourceId,
      officialPdfUrl: project.source.officialPdfUrl,
      officialRecordUrl: project.source.officialRecordUrl,
      naraNaid: project.source.naraNaid,
      pdfPageCount: project.source.pageCount,
      byteLength: project.source.byteLength,
      sourceSha256: project.source.sha256,
      recordAssociationVerifiedByOpstalia: false
    },
    batch: {
      derivativeCount: derivatives.length,
      selectedPageCopies: plan.totalSelectedPages,
      uniqueCoveredPages: plan.uniqueCoveredPages,
      uncoveredSourceRanges: plan.uncoveredRanges,
      preflightIssues: plan.issues,
      derivatives: derivatives.map(({ pdfBytes, ...item }) => ({
        ...item,
        path: `documents/${item.fileName}`,
        byteLength: pdfBytes.byteLength
      })),
      manifestOnlyItems: plan.manifestOnlyItems,
      excludedPageRanges: plan.excludedPageRanges
    },
    exclusions: [
      "The complete official source PDF",
      "Extracted or OCR page text",
      "Rendered page images",
      "Relay session tokens"
    ]
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = Uint8Array.from(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function assertGeneratedAt(value: string): void {
  if (!value || Number.isNaN(Date.parse(value))) {
    throw new Error("Batch package generation time must be a valid date-time string.");
  }
}

export async function buildBatchResearchPacket(
  project: PdfPacketProject,
  artifacts: BatchDerivativeArtifact[],
  options: BatchExportOptions = {}
): Promise<BatchResearchPacket> {
  const plan = createBatchExportPlan(project, options);
  if (!plan.canExport) {
    const errors = plan.issues.filter((issue) => issue.severity === "error");
    throw new Error(errors.map((issue) => issue.message).join(" ") || "No confirmed page range is available for export.");
  }
  if (artifacts.length !== plan.derivativeItems.length) {
    throw new Error(`Expected ${plan.derivativeItems.length} derivative artifacts but received ${artifacts.length}.`);
  }
  const artifactsBySegment = new Map<string, BatchDerivativeArtifact>();
  for (const artifact of artifacts) {
    if (artifactsBySegment.has(artifact.segmentId)) {
      throw new Error(`Duplicate derivative artifact for segment ${artifact.segmentId}.`);
    }
    if (!artifact.pdfBytes.byteLength || new TextDecoder().decode(artifact.pdfBytes.subarray(0, 5)) !== "%PDF-") {
      throw new Error(`Derivative artifact for segment ${artifact.segmentId} is not a PDF.`);
    }
    artifactsBySegment.set(artifact.segmentId, artifact);
  }

  const derivatives: HashedDerivative[] = [];
  for (const item of plan.derivativeItems) {
    const artifact = artifactsBySegment.get(item.segmentId);
    if (!artifact) throw new Error(`Missing derivative artifact for segment ${item.segmentId}.`);
    const sha256 = await sha256Hex(artifact.pdfBytes);
    if (artifact.expectedSha256 && artifact.expectedSha256.toLocaleLowerCase() !== sha256) {
      throw new Error(`Derivative checksum did not match for segment ${item.segmentId}.`);
    }
    derivatives.push({ ...item, pdfBytes: artifact.pdfBytes, sha256 });
  }

  const generatedAt = options.generatedAt ?? new Date().toISOString();
  assertGeneratedAt(generatedAt);
  const entries: Record<string, Uint8Array> = {};
  for (const derivative of derivatives) {
    entries[`documents/${derivative.fileName}`] = derivative.pdfBytes;
  }
  entries["manifest.json"] = strToU8(`${JSON.stringify(batchManifest(project, plan, derivatives, generatedAt), null, 2)}\n`);
  entries["register.csv"] = strToU8(batchRegisterCsv(project, plan, derivatives));
  entries["README.md"] = strToU8(packetReadme(project, plan, derivatives, generatedAt));

  const checksummedFiles: BatchPackagedFile[] = [];
  for (const path of Object.keys(entries).sort((left, right) => left.localeCompare(right))) {
    const sha256 = await sha256Hex(entries[path]);
    checksummedFiles.push({
      path,
      byteLength: entries[path].byteLength,
      sha256,
      kind: path.startsWith("documents/")
        ? "derivative"
        : path === "manifest.json"
          ? "manifest"
          : path === "register.csv"
            ? "register"
            : "readme"
    });
  }
  entries["SHA256SUMS.txt"] = strToU8(
    checksummedFiles.map((file) => `${file.sha256}  ${file.path}`).join("\n") + "\n"
  );
  const checksumsSha256 = await sha256Hex(entries["SHA256SUMS.txt"]);
  const files: BatchPackagedFile[] = [
    ...checksummedFiles,
    {
      path: "SHA256SUMS.txt",
      byteLength: entries["SHA256SUMS.txt"].byteLength,
      sha256: checksumsSha256,
      kind: "checksums"
    }
  ];
  return {
    zipBytes: zipSync(entries, { level: 0 }),
    plan,
    files
  };
}
