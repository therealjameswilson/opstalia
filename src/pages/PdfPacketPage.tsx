import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import type {
  PdfPacketDerivativeReceipt,
  PdfPacketProject,
  PdfPacketSegment,
  PdfPacketSegmentKind
} from "../core/types";
import { makeId } from "../core/id";
import { getSource } from "../data/registry";
import {
  deletePdfPacketProject,
  listPdfPacketProjects,
  savePdfPacketProject
} from "../persistence/database";
import { validateNaraPresidentialLibraryPacket } from "../security/url-policy";
import { ExternalLink, FieldProvenance, SectionHeading } from "../ui/common";
import { createPdfSession, MAX_BROWSER_DERIVATIVE_SOURCE_BYTES, packetApiConfigured } from "../pdf/client";
import { proposePacketSegments, type PacketPageText } from "../pdf/detect-boundaries";
import {
  createBatchDerivativesInWorker,
  createDerivativeInWorker,
  downloadBoundedSourcePdf,
  inspectOfficialPdfPageText,
  MAX_EMBEDDED_TEXT_CHARS_PER_PAGE,
  openOfficialPdf,
  renderOfficialPdfPage
} from "../pdf/pdf-engine";
import {
  buildBatchResearchPacket,
  createBatchExportPlan,
  type BatchDerivativePlanItem
} from "../pdf/batch-export";
import { pageRangeLabel, validatePageRange } from "../pdf/page-ranges";
import { migrateLegacyPacketAnnotationSafety } from "../pdf/legacy-packet-migration";
import {
  packetManifestCsv,
  packetManifestJson,
  packetManifestMarkdown
} from "../pdf/provenance-manifest";

const SOURCE_ID = "presidential-libraries" as const;
const MAX_SCAN_PAGES = 5_000;
const MAX_SCAN_TEXT_CHARS = 32 * 1024 * 1024;
const DEMO = {
  title: "CSCE Paris Summit briefing-book packet",
  naid: "470761856",
  recordUrl: "https://catalog.archives.gov/id/470761856",
  pdfUrl: "https://catalog.archives.gov/medialz/presidential-libraries/bush/gb-nsc/euro_sov_dir_374000442/41-bpr-nsc-euro_sov-brief_bks-cf01014-017.pdf"
};

function bytesLabel(bytes?: number): string {
  if (!bytes) return "Unknown size";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function safeFilename(value: string, extension: string): string {
  const base = value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "opstalia-packet";
  return `${base}.${extension}`;
}

function downloadFile(name: string, contents: BlobPart, type: string): void {
  const href = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}

function cautiousReleaseStatus(kind: PdfPacketSegmentKind): PdfPacketSegment["releaseStatus"] {
  return {
    status: "not_determined",
    determinationBasis: kind === "described_item"
      ? "A researcher-recorded description does not by itself establish a withdrawal notice or release status."
      : "A researcher-defined page range is not an official release-status determination.",
    source: "Opstalia cautious default",
    confidence: 1,
    humanReview: true
  };
}

function removeStaleDerivativeHash(notes?: string): string | undefined {
  if (!notes) return notes;
  const lines = notes.split("\n");
  if (!lines.some((line) => line.startsWith("Latest derivative SHA-256:"))) return notes;
  const retained = lines
    .filter((line) => !line.startsWith("Latest derivative SHA-256:"));
  retained.push("Prior derivative hash removed because the official source SHA-256 changed; regenerate after re-review.");
  return retained.join("\n");
}

function matchSnippet(text: string, query: string): string {
  const index = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (index < 0) return text.slice(0, 160);
  const start = Math.max(0, index - 60);
  const end = Math.min(text.length, index + query.length + 100);
  return `${start ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

function segmentMatchesPlan(segment: PdfPacketSegment | undefined, item: BatchDerivativePlanItem): boolean {
  return Boolean(
    segment &&
    segment.title === item.title &&
    segment.startPage === item.startPage &&
    segment.endPage === item.endPage &&
    (segment.reviewStatus === "researcher_confirmed" || segment.reviewStatus === "researcher_corrected")
  );
}

function SegmentCard({
  project,
  segment,
  onChange,
  onNavigate,
  onExport,
  onCancelExport,
  exportBusy,
  exportActive,
  selectedForBatch,
  onBatchSelection
}: {
  project: PdfPacketProject;
  segment: PdfPacketSegment;
  onChange: (segment: PdfPacketSegment) => void;
  onNavigate: (page: number) => void;
  onExport: (segment: PdfPacketSegment) => void;
  onCancelExport: () => void;
  exportBusy: boolean;
  exportActive: boolean;
  selectedForBatch: boolean;
  onBatchSelection: (selected: boolean) => void;
}) {
  const exportHelpId = useId();
  const rejected = segment.reviewStatus === "researcher_rejected";
  const confirmed = segment.reviewStatus === "researcher_confirmed" || segment.reviewStatus === "researcher_corrected";
  const exportAvailable = Boolean(
    project.source.byteLength &&
    project.source.byteLength <= MAX_BROWSER_DERIVATIVE_SOURCE_BYTES &&
    project.source.sha256
  );
  const annotationPages = project.scan.annotationPages ?? [];
  const annotatedPagesInRange = segment.kind === "page_range" && segment.startPage && segment.endPage
    ? annotationPages.filter((page) => page >= segment.startPage! && page <= segment.endPage!)
    : [];
  const annotationBlocked = annotatedPagesInRange.length > 0;
  const exportHelp = !confirmed
    ? "Confirm this page range before exporting it."
    : !exportAvailable
      ? "Reopen the official packet to establish a reviewed source fingerprint; PDF sources are limited to 100 MB."
      : annotationBlocked
        ? `Export is blocked because annotation-bearing PDF page${annotatedPagesInRange.length === 1 ? "" : "s"} ${annotatedPagesInRange.join(", ")} may cover underlying text.`
        : "This confirmed range can be exported as a research derivative.";
  const update = (changes: Partial<PdfPacketSegment>) => {
    if (exportBusy) return;
    onChange({
      ...segment,
      ...changes,
      reviewStatus: changes.reviewStatus ?? (segment.detectionMethod === "pattern_match" ? "researcher_corrected" : segment.reviewStatus),
      updatedAt: new Date().toISOString()
    });
  };
  return (
    <article
      className={`packet-segment ${rejected ? "packet-segment-rejected" : ""}`}
      aria-label={`Packet item: ${segment.title}`}
    >
      <header>
        <div>
          <span className={`packet-kind packet-kind-${segment.kind}`}>
            {segment.kind === "page_range" ? "Researcher page range" : "Described item only"}
          </span>
          <span className={`provenance-label ${segment.detectionMethod === "pattern_match" ? "provenance-inferred" : "provenance-researcher"}`}>
            {segment.detectionMethod === "pattern_match" ? "Pattern-detected proposal" : "Researcher-defined item"}
          </span>
          {segment.reviewStatus === "researcher_corrected" ? <FieldProvenance kind="corrected" />
            : segment.reviewStatus === "researcher_confirmed" ? <FieldProvenance kind="researcher" />
              : <span className="provenance-label">{rejected ? "Researcher rejected" : "Review pending"}</span>}
        </div>
        <strong>{Math.round(segment.confidence * 100)}% {confirmed ? "review confidence" : "proposal confidence"}</strong>
      </header>
      <label>
        <span>Item title</span>
        <input
          value={segment.title}
          maxLength={500}
          disabled={rejected || exportBusy}
          onChange={(event) => update({ title: event.target.value, confidence: 1 })}
        />
      </label>
      {segment.kind === "page_range" ? (
        <div className="packet-range-fields">
          <label>
            <span>Start PDF page</span>
            <input
              type="number"
              min="1"
              max={project.source.pageCount}
              value={segment.startPage}
              disabled={rejected || exportBusy}
              onChange={(event) => update({ startPage: Number(event.target.value), confidence: 1 })}
            />
          </label>
          <label>
            <span>End PDF page</span>
            <input
              type="number"
              min="1"
              max={project.source.pageCount}
              value={segment.endPage}
              disabled={rejected || exportBusy}
              onChange={(event) => update({ endPage: Number(event.target.value), confidence: 1 })}
            />
          </label>
          <p>
            {segment.startPage && segment.endPage
              ? pageRangeLabel({ startPage: segment.startPage, endPage: segment.endPage })
              : "Range incomplete"}
          </p>
        </div>
      ) : (
        <div className="packet-range-fields">
          <label>
            <span>Described extent</span>
            <input
              type="number"
              min="1"
              max="10000"
              value={segment.describedExtent ?? ""}
              disabled={rejected || exportBusy}
              onChange={(event) => update({ describedExtent: Number(event.target.value) || undefined, confidence: 1 })}
            />
          </label>
          <label>
            <span>Evidence PDF page</span>
            <input
              type="number"
              min="1"
              max={project.source.pageCount}
              value={segment.evidencePages?.[0] ?? ""}
              disabled={rejected || exportBusy}
              onChange={(event) => update({ evidencePages: Number(event.target.value) ? [Number(event.target.value)] : [], confidence: 1 })}
            />
          </label>
          <p>No content-page range is claimed.</p>
        </div>
      )}
      <div className="packet-metadata-fields">
        <label>
          <span>Document date</span>
          <input
            value={segment.date ?? ""}
            maxLength={80}
            disabled={rejected || exportBusy}
            placeholder="YYYY-MM-DD or source wording"
            onChange={(event) => update({ date: event.target.value || undefined, confidence: 1 })}
          />
        </label>
        <label>
          <span>Document type</span>
          <input
            value={segment.documentType ?? ""}
            maxLength={200}
            disabled={rejected || exportBusy}
            placeholder="Memcon, memorandum, cable…"
            onChange={(event) => update({ documentType: event.target.value || undefined, confidence: 1 })}
          />
        </label>
        <label>
          <span>Identifier</span>
          <input
            value={segment.identifier ?? ""}
            maxLength={300}
            disabled={rejected || exportBusy}
            placeholder="Document, cable, or control number"
            onChange={(event) => update({ identifier: event.target.value || undefined, confidence: 1 })}
          />
        </label>
      </div>
      <details>
        <summary>Basis and proposal reasons</summary>
        <p>{segment.releaseStatus.determinationBasis}</p>
        <ul>{segment.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        <p className="fine-print">Public visibility and absence of obvious redactions do not establish release in full.</p>
      </details>
      <div className="packet-segment-actions">
        {segment.startPage && <button className="button button-secondary" aria-label={`View start page for ${segment.title}`} disabled={exportBusy} onClick={() => onNavigate(segment.startPage!)}>View start page</button>}
        {segment.evidencePages?.[0] && <button className="button button-secondary" aria-label={`View evidence page for ${segment.title}`} disabled={exportBusy} onClick={() => onNavigate(segment.evidencePages![0])}>View evidence page</button>}
        {!rejected && (
          <button
            className="button button-secondary"
            aria-label={`Confirm ${segment.title}`}
            disabled={exportBusy}
            aria-pressed={confirmed}
            onClick={() => update({
              reviewStatus: "researcher_confirmed",
              confidence: 1,
              reasons: [...new Set([...segment.reasons, "Range or item description confirmed by researcher"])]
            })}
          >
            {confirmed ? "Confirmed" : "Confirm"}
          </button>
        )}
        {segment.kind === "page_range" && (
          <button
            className="button button-primary"
            disabled={!confirmed || rejected || !exportAvailable || exportBusy || annotationBlocked}
            aria-label={`Export derivative PDF for ${segment.title}`}
            aria-describedby={exportHelpId}
            title={!exportAvailable
              ? "Page-range derivative export requires a reviewed source fingerprint and is limited to PDFs no larger than 100 MB"
              : annotationBlocked
                ? `Derivative export is blocked because annotation-bearing PDF page${annotatedPagesInRange.length === 1 ? "" : "s"} ${annotatedPagesInRange.join(", ")} may cover underlying text`
              : confirmed ? "Create a research derivative from the confirmed page range" : "Confirm the range before exporting"}
            onClick={() => onExport(segment)}
          >
            {exportActive ? "Derivative export in progress…" : "Export derivative PDF"}
          </button>
        )}
        {exportActive && (
          <button
            className="text-button"
            aria-label={`Cancel derivative export for ${segment.title}`}
            onClick={onCancelExport}
          >
            Cancel derivative export
          </button>
        )}
        <button
          className="text-button"
          aria-label={`${rejected ? "Restore" : "Reject"} ${segment.title}`}
          disabled={exportBusy}
          aria-pressed={rejected}
          onClick={() => update({
            reviewStatus: rejected ? "proposed" : "researcher_rejected",
            reasons: [...new Set([...segment.reasons, rejected ? "Proposal restored for review" : "Proposal rejected by researcher"])]
          })}
        >
          {rejected ? "Restore proposal" : "Reject proposal"}
        </button>
      </div>
      {segment.kind === "page_range" && <p id={exportHelpId} className="sr-only">{exportHelp}</p>}
      {segment.kind === "page_range" && (
        <label className="packet-batch-select">
          <input
            type="checkbox"
            checked={selectedForBatch}
            aria-label={`Include ${segment.title} in the batch research packet`}
            disabled={!confirmed || rejected || exportBusy || annotationBlocked}
            onChange={(event) => onBatchSelection(event.target.checked)}
          />
          <span>Include this confirmed range in the batch research packet</span>
        </label>
      )}
      {annotationBlocked && (
        <p className="packet-annotation-warning" role="alert">
          Derivative export blocked: annotation-bearing PDF page{annotatedPagesInRange.length === 1 ? "" : "s"} {annotatedPagesInRange.join(", ")} may visually cover underlying text. Review the unchanged official PDF.
        </p>
      )}
      {segment.derivativeExports?.length ? (
        <details className="packet-export-receipts">
          <summary>{segment.derivativeExports.length} derivative export receipt{segment.derivativeExports.length === 1 ? "" : "s"}</summary>
          <ul>{segment.derivativeExports.slice().reverse().map((receipt) => (
            <li key={receipt.id}>{receipt.fileName} · pages {receipt.startPage}–{receipt.endPage} · SHA-256 {receipt.derivativeSha256}</li>
          ))}</ul>
        </details>
      ) : null}
    </article>
  );
}

export default function PdfPacketPage() {
  const source = getSource(SOURCE_ID)!;
  const [savedProjects, setSavedProjects] = useState<PdfPacketProject[]>([]);
  const [project, setProject] = useState<PdfPacketProject>();
  const [name, setName] = useState("");
  const [naid, setNaid] = useState("");
  const [recordUrl, setRecordUrl] = useState("");
  const [pdfUrl, setPdfUrl] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [privateMode, setPrivateMode] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [currentText, setCurrentText] = useState("");
  const [currentAnnotationCount, setCurrentAnnotationCount] = useState(0);
  const [pageTexts, setPageTexts] = useState<PacketPageText[]>([]);
  const [searchText, setSearchText] = useState("");
  const [loadState, setLoadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [scanProgress, setScanProgress] = useState(0);
  const [exportProgress, setExportProgress] = useState(0);
  const [isScanning, setIsScanning] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [activeExportId, setActiveExportId] = useState<string>();
  const [renderScale, setRenderScale] = useState(1.25);
  const [fitWidth, setFitWidth] = useState(true);
  const [pageAnnouncement, setPageAnnouncement] = useState("");
  const [transferProgress, setTransferProgress] = useState<{ loaded: number; total?: number }>();
  const [newKind, setNewKind] = useState<PdfPacketSegmentKind>("page_range");
  const [newTitle, setNewTitle] = useState("");
  const [newStart, setNewStart] = useState(1);
  const [newEnd, setNewEnd] = useState(1);
  const [newExtent, setNewExtent] = useState("");
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<string[]>([]);
  const [allowBatchWarnings, setAllowBatchWarnings] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const documentRef = useRef<PDFDocumentProxy | undefined>(undefined);
  const projectRef = useRef<PdfPacketProject | undefined>(undefined);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | undefined>(undefined);
  const openControllerRef = useRef<AbortController | undefined>(undefined);
  const scanControllerRef = useRef<AbortController | undefined>(undefined);
  const exportControllerRef = useRef<AbortController | undefined>(undefined);
  const exportingRef = useRef(false);
  const renderControllerRef = useRef<AbortController | undefined>(undefined);
  const openGenerationRef = useRef(0);
  const currentPageRef = useRef(1);
  const renderQueueRef = useRef<Promise<void>>(Promise.resolve());

  const refreshSaved = async () => setSavedProjects(await listPdfPacketProjects());

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    void refreshSaved();
    return () => {
      openGenerationRef.current += 1;
      openControllerRef.current?.abort();
      scanControllerRef.current?.abort();
      exportControllerRef.current?.abort();
      renderControllerRef.current?.abort();
      void loadingTaskRef.current?.destroy();
    };
  }, []);

  useEffect(() => {
    currentPageRef.current = currentPage;
    const activeDocument = documentRef.current;
    const canvas = canvasRef.current;
    if (!activeDocument || !canvas || !project) return;
    const pageNumber = currentPage;
    const sessionGeneration = openGenerationRef.current;
    renderControllerRef.current?.abort();
    const controller = new AbortController();
    renderControllerRef.current = controller;
    setCurrentText("");
    setCurrentAnnotationCount(0);
    setPageAnnouncement(`Loading PDF page ${pageNumber} of ${project.source.pageCount}.`);
    renderQueueRef.current = renderQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (
          controller.signal.aborted ||
          documentRef.current !== activeDocument ||
          openGenerationRef.current !== sessionGeneration ||
          currentPageRef.current !== pageNumber
        ) return;
        await renderOfficialPdfPage(activeDocument, pageNumber, canvas, renderScale, controller.signal);
        if (controller.signal.aborted || currentPageRef.current !== pageNumber) return;
        const inspection = await inspectOfficialPdfPageText(activeDocument, pageNumber);
        if (controller.signal.aborted || currentPageRef.current !== pageNumber || openGenerationRef.current !== sessionGeneration) return;
        setCurrentText(inspection.text);
        setCurrentAnnotationCount(inspection.annotationCount);
        setPageAnnouncement(
          `PDF page ${pageNumber} of ${project.source.pageCount} rendered. ${inspection.textSuppressedForAnnotations
            ? `${inspection.annotationCount} annotation${inspection.annotationCount === 1 ? " was" : "s were"} rendered; embedded-text display is suppressed as a safety precaution.`
            : inspection.text
              ? "Embedded text is available below."
              : "No embedded text was available; review the page image manually."}`
        );
      })
      .catch((cause) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError")) {
          setError(cause instanceof Error ? cause.message : "Unable to render the selected page.");
        }
      });
    return () => controller.abort();
  }, [currentPage, project, renderScale]);

  const searchMatches = useMemo(() => {
    const query = searchText.trim().toLocaleLowerCase();
    if (!query) return [];
    return pageTexts.filter((page) => page.text.toLocaleLowerCase().includes(query)).slice(0, 200);
  }, [pageTexts, searchText]);

  const batchPlan = useMemo(
    () => project ? createBatchExportPlan(project, { selectedSegmentIds }) : undefined,
    [project, selectedSegmentIds]
  );
  const batchWarnings = batchPlan?.issues.filter((issue) =>
    issue.code === "overlap" || issue.code === "exact_duplicate"
  ) ?? [];
  const batchErrors = batchPlan?.issues.filter((issue) => issue.severity === "error") ?? [];
  const visibleBatchIssues = batchPlan
    ? [
        ...batchErrors,
        ...batchPlan.issues
          .filter((issue) => issue.severity !== "error")
          .slice(0, Math.max(0, 40 - batchErrors.length))
      ]
    : [];
  const knownAnnotatedBatchPages = useMemo(() => {
    if (!batchPlan || !project?.scan.annotationPages?.length) return [];
    return project.scan.annotationPages.filter((page) =>
      batchPlan.derivativeItems.some((item) => page >= item.startPage && page <= item.endPage)
    );
  }, [batchPlan, project]);
  const batchExportHelp = isExporting
    ? "A batch export is already in progress."
    : !acknowledged
      ? "Acknowledge the public, unclassified-source notice before exporting."
      : !batchPlan?.canExport
        ? "Select at least one valid, confirmed page range and resolve every preflight error."
        : knownAnnotatedBatchPages.length
          ? "Remove annotation-bearing pages from the batch before exporting."
          : batchWarnings.length > 0 && !allowBatchWarnings
            ? "Review and acknowledge the overlap or duplicate-range warnings before exporting."
            : "The selected batch is ready for a fresh source-fingerprint check and local export.";

  const fillDemo = () => {
    setName(DEMO.title);
    setNaid(DEMO.naid);
    setRecordUrl(DEMO.recordUrl);
    setPdfUrl(DEMO.pdfUrl);
    setError("");
  };

  const openPacket = async (preset?: PdfPacketProject) => {
    if (exportingRef.current) {
      setError("Finish or cancel the current derivative export before opening another packet.");
      return;
    }
    const effectiveName = preset?.name ?? name.trim();
    const effectiveNaid = preset?.source.naraNaid ?? naid.trim();
    const effectiveRecordUrl = preset?.source.officialRecordUrl ?? recordUrl.trim();
    const effectivePdfUrl = preset?.source.officialPdfUrl ?? pdfUrl.trim();
    setError("");
    setStatus("");
    if (!acknowledged) {
      setError("Acknowledge the public, unclassified-source notice before opening a packet.");
      return;
    }
    if (!effectiveName || !effectiveNaid || !effectiveRecordUrl || !effectivePdfUrl) {
      setError("Enter a project name, NARA NAID, canonical Catalog record URL, and direct official packet PDF URL.");
      return;
    }
    const admission = validateNaraPresidentialLibraryPacket(
      { officialPdfUrl: effectivePdfUrl, officialRecordUrl: effectiveRecordUrl, naraNaid: effectiveNaid },
      source
    );
    if (!admission.allowed) {
      setError(admission.reason);
      return;
    }
    const generation = openGenerationRef.current + 1;
    openGenerationRef.current = generation;
    openControllerRef.current?.abort();
    const openController = new AbortController();
    openControllerRef.current = openController;
    setLoadState("loading");
    setStatus("Validating the official packet, then transferring one bounded public copy into this browser…");
    setProject(undefined);
    documentRef.current = undefined;
    renderControllerRef.current?.abort();
    scanControllerRef.current?.abort();
    exportControllerRef.current?.abort();
    exportingRef.current = false;
    setIsScanning(false);
    setIsExporting(false);
    setSelectedSegmentIds([]);
    setAllowBatchWarnings(false);
    setCurrentAnnotationCount(0);
    setTransferProgress(undefined);
    try {
      await loadingTaskRef.current?.destroy();
      loadingTaskRef.current = undefined;
      const session = await createPdfSession({
        sourceId: SOURCE_ID,
        naraNaid: effectiveNaid,
        officialRecordUrl: admission.canonicalRecordUrl!,
        officialPdfUrl: admission.canonicalPdfUrl!,
        acknowledgedPublicUnclassified: true
      }, openController.signal);
      const opened = await openOfficialPdf(
        session.contentUrl,
        session.byteLength,
        (loaded, total) => {
          if (generation === openGenerationRef.current) {
            setTransferProgress({ loaded, total: total ?? session.byteLength ?? undefined });
          }
        },
        (streamError) => setError(streamError.message),
        openController.signal
      );
      if (generation !== openGenerationRef.current) {
        await opened.loadingTask.destroy();
        return;
      }
      if (opened.document.numPages > 20_000) {
        await opened.loadingTask.destroy();
        throw new Error("The PDF exceeds the 20,000-page public-workspace limit.");
      }
      documentRef.current = opened.document;
      loadingTaskRef.current = opened.loadingTask;
      const now = new Date().toISOString();
      const migratedPreset = preset
        ? migrateLegacyPacketAnnotationSafety(preset, now)
        : undefined;
      const safePreset = migratedPreset?.project;
      const sourceUnchanged = Boolean(
        preset &&
        preset.source.byteLength === opened.byteLength &&
        preset.source.sha256 &&
        preset.source.sha256 === opened.sha256
      );
      const next: PdfPacketProject = safePreset
        ? {
            ...safePreset,
            privateMode,
            updatedAt: now,
            source: {
              ...safePreset.source,
              sha256: opened.sha256,
              pageCount: opened.document.numPages,
              byteLength: opened.byteLength,
              etag: session.etag,
              lastModified: session.lastModified,
              inspectedAt: now
            },
            segments: sourceUnchanged ? safePreset.segments : safePreset.segments.map((segment) => ({
              ...segment,
              notes: removeStaleDerivativeHash(segment.notes),
              derivativeExports: undefined,
              reviewStatus: segment.reviewStatus === "researcher_rejected" ? "researcher_rejected" as const : "proposed" as const,
              reasons: [...new Set([...segment.reasons, "The newly computed source hash did not match a saved hash; re-review required"])],
              updatedAt: now
            })),
            scan: sourceUnchanged
              ? safePreset.scan
              : { pagesScanned: 0, pagesWithText: 0, pagesWithAnnotations: 0, annotationPages: [] }
          }
        : {
            id: makeId("pdf-packet"),
            name: effectiveName,
            createdAt: now,
            updatedAt: now,
            privateMode,
            source: {
              sourceId: SOURCE_ID,
              title: effectiveName,
              officialPdfUrl: admission.canonicalPdfUrl!,
              officialRecordUrl: admission.canonicalRecordUrl!,
              naraNaid: effectiveNaid,
              pageCount: opened.document.numPages,
              byteLength: opened.byteLength,
              sha256: opened.sha256,
              etag: session.etag,
              lastModified: session.lastModified,
              inspectedAt: now
            },
            segments: [],
            scan: { pagesScanned: 0, pagesWithText: 0, pagesWithAnnotations: 0, annotationPages: [] }
          };
      projectRef.current = next;
      setProject(next);
      setName(effectiveName);
      setNaid(effectiveNaid);
      setRecordUrl(admission.canonicalRecordUrl!);
      setPdfUrl(admission.canonicalPdfUrl!);
      setCurrentPage(1);
      setNewStart(1);
      setNewEnd(1);
      setPageTexts([]);
      setScanProgress(0);
      // Batch scope is always explicit for the current open session. Reopening
      // or confirming a range must never silently broaden an export selection.
      setSelectedSegmentIds([]);
      setLoadState("ready");
      setTransferProgress(undefined);
      setStatus(
        `${sourceUnchanged || !preset ? "Ready" : "Ready; saved range decisions require re-review because the newly computed source hash did not match a saved hash"}: ${opened.document.numPages} pages, ${bytesLabel(opened.byteLength)}. The original remains NARA-hosted; one bounded public copy transited the relay and is processed transiently in this browser.${migratedPreset?.migrated ? ` Pre-1.3 review state was reset for annotation safety, and ${migratedPreset.removedPatternSuggestions} legacy pattern suggestion${migratedPreset.removedPatternSuggestions === 1 ? " was" : "s were"} removed; run a new scan and review the retained researcher-defined items.` : ""}`
      );
    } catch (cause) {
      if (generation !== openGenerationRef.current) return;
      const cancelled = cause instanceof DOMException && cause.name === "AbortError";
      setLoadState(cancelled ? "idle" : "error");
      setError(cancelled ? "" : cause instanceof Error ? cause.message : "Unable to open the official packet.");
      setStatus(cancelled ? "Packet opening cancelled. No PDF bytes were retained by Opstalia." : "");
      setTransferProgress(undefined);
    } finally {
      if (openControllerRef.current === openController) openControllerRef.current = undefined;
    }
  };

  const updateProject = (update: PdfPacketProject | ((current: PdfPacketProject) => PdfPacketProject)) => {
    setProject((current) => {
      if (!current) return current;
      const next = typeof update === "function" ? update(current) : update;
      projectRef.current = next;
      return next;
    });
  };

  const scanText = async () => {
    if (!documentRef.current || !project || isScanning) return;
    scanControllerRef.current?.abort();
    const controller = new AbortController();
    scanControllerRef.current = controller;
    setIsScanning(true);
    setScanProgress(0);
    setError("");
    setStatus("Scanning the PDF’s embedded text layer. No text is sent to an OCR or AI service.");
    const pages: PacketPageText[] = [];
    const annotationPages: number[] = [];
    let totalTextCharacters = 0;
    let limitedReason: string | undefined;
    try {
      const pageLimit = Math.min(project.source.pageCount, MAX_SCAN_PAGES);
      for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
        if (controller.signal.aborted) throw new DOMException("Scan cancelled", "AbortError");
        const inspection = await inspectOfficialPdfPageText(documentRef.current, pageNumber);
        if (inspection.textSuppressedForAnnotations) annotationPages.push(pageNumber);
        if (totalTextCharacters + inspection.text.length > MAX_SCAN_TEXT_CHARS) {
          limitedReason = `The in-memory scan stopped before PDF page ${pageNumber} at the ${Math.floor(MAX_SCAN_TEXT_CHARS / 1024 / 1024)} million-character safety budget.`;
          break;
        }
        pages.push({ pageNumber, text: inspection.text });
        totalTextCharacters += inspection.text.length;
        setScanProgress(pageNumber);
        if (pageNumber % 4 === 0) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      if (!limitedReason && project.source.pageCount > MAX_SCAN_PAGES) {
        limitedReason = `The deterministic scan stopped after ${MAX_SCAN_PAGES.toLocaleString()} pages; later pages remain available for manual review.`;
      }
      const proposals = proposePacketSegments(pages, pages.length);
      const withText = pages.filter((page) => page.text.length > 0).length;
      setPageTexts(pages);
      if (annotationPages.length) {
        setSelectedSegmentIds((current) => current.filter((id) => {
          const segment = project.segments.find((item) => item.id === id);
          return !segment?.startPage || !segment.endPage || !annotationPages.some(
            (page) => page >= segment.startPage! && page <= segment.endPage!
          );
        }));
        setAllowBatchWarnings(false);
      }
      updateProject((current) => ({
        ...current,
        updatedAt: new Date().toISOString(),
        segments: [
          ...current.segments,
          ...proposals.filter((proposal) => !current.segments.some(
            (segment) => segment.kind === proposal.kind &&
              segment.startPage === proposal.startPage &&
              segment.evidencePages?.[0] === proposal.evidencePages?.[0]
          ))
        ],
        scan: {
          pagesScanned: pages.length,
          pagesWithText: withText,
          pagesWithAnnotations: annotationPages.length,
          annotationPages,
          completedAt: limitedReason ? undefined : new Date().toISOString(),
          limitedReason
        }
      }));
      setStatus(
        `Scanned ${pages.length} pages; ${withText} contained safely displayable embedded text. Embedded text was suppressed on ${annotationPages.length} annotation-bearing page${annotationPages.length === 1 ? "" : "s"}. Added ${proposals.length} editable boundary suggestion${proposals.length === 1 ? "" : "s"}.${limitedReason ? ` ${limitedReason}` : ""}`
      );
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") setStatus("Text scan cancelled.");
      else setError(cause instanceof Error ? cause.message : "The embedded-text scan failed.");
    } finally {
      setIsScanning(false);
    }
  };

  const addSegment = () => {
    if (isExporting) return;
    if (!project || !newTitle.trim()) {
      setError("Give the page range or described item a title.");
      return;
    }
    if (newKind === "page_range") {
      const range = validatePageRange(newStart, newEnd, project.source.pageCount);
      if (!range.valid) {
        setError(range.reason);
        return;
      }
    }
    const now = new Date().toISOString();
    const segment: PdfPacketSegment = {
      id: makeId("packet-segment"),
      kind: newKind,
      title: newTitle.trim(),
      startPage: newKind === "page_range" ? newStart : undefined,
      endPage: newKind === "page_range" ? newEnd : undefined,
      evidencePages: newKind === "described_item" ? [currentPage] : undefined,
      describedExtent: newKind === "described_item" ? Number(newExtent) || undefined : undefined,
      releaseStatus: cautiousReleaseStatus(newKind),
      detectionMethod: "researcher_defined",
      confidence: 1,
      reasons: ["Range or described-only item defined by researcher"],
      reviewStatus: "researcher_confirmed",
      createdAt: now,
      updatedAt: now
    };
    updateProject({ ...project, segments: [...project.segments, segment], updatedAt: now });
    setNewTitle("");
    setNewExtent("");
    setError("");
  };

  const downloadFreshSourceForExport = async (
    snapshot: PdfPacketProject,
    controller: AbortController
  ): Promise<ArrayBuffer> => {
    if (!acknowledged) throw new Error("Reconfirm the public, unclassified-source notice before exporting a derivative.");
    if (
      !snapshot.source.naraNaid ||
      !snapshot.source.officialRecordUrl ||
      !snapshot.source.byteLength ||
      !snapshot.source.sha256
    ) {
      throw new Error("Reopen the official packet to establish a current source length and SHA-256 before exporting.");
    }
    const session = await createPdfSession({
      sourceId: SOURCE_ID,
      naraNaid: snapshot.source.naraNaid,
      officialRecordUrl: snapshot.source.officialRecordUrl,
      officialPdfUrl: snapshot.source.officialPdfUrl,
      acknowledgedPublicUnclassified: true
    }, controller.signal);
    const expectedLength = session.byteLength ?? snapshot.source.byteLength;
    return downloadBoundedSourcePdf(
      session.contentUrl,
      expectedLength,
      (loaded) => setExportProgress(loaded),
      controller.signal
    );
  };

  const exportDerivative = async (segment: PdfPacketSegment) => {
    if (!project || segment.kind !== "page_range" || !segment.startPage || !segment.endPage || exportingRef.current) return;
    const range = validatePageRange(segment.startPage, segment.endPage, project.source.pageCount);
    if (!range.valid) {
      setError(range.reason);
      return;
    }
    const plan = createBatchExportPlan(project, { selectedSegmentIds: [segment.id] });
    const planItem = plan.derivativeItems[0];
    if (!plan.canExport || !planItem || !project.source.sha256) {
      setError("Confirm this valid page range and reopen the official packet before exporting it.");
      return;
    }
    const annotatedPages = (project.scan.annotationPages ?? []).filter(
      (page) => page >= planItem.startPage && page <= planItem.endPage
    );
    if (annotatedPages.length) {
      setError(`Derivative export is blocked because annotation-bearing PDF page${annotatedPages.length === 1 ? "" : "s"} ${annotatedPages.join(", ")} may cover underlying text.`);
      return;
    }
    setError("");
    setExportProgress(0);
    exportingRef.current = true;
    setIsExporting(true);
    setActiveExportId(segment.id);
    const controller = new AbortController();
    exportControllerRef.current = controller;
    const snapshot = project;
    const expectedSourceSha256 = snapshot.source.sha256!;
    const sessionGeneration = openGenerationRef.current;
    setStatus("Creating a fresh bounded relay session, downloading the official source once, checking its fingerprint, and extracting the confirmed range in an isolated browser worker…");
    try {
      const sourceBytes = await downloadFreshSourceForExport(snapshot, controller);
      const result = await createDerivativeInWorker({
        sourceBytes,
        expectedSourceSha256,
        segmentId: planItem.segmentId,
        startPage: planItem.startPage,
        endPage: planItem.endPage,
        title: planItem.title,
        provenance: `Researcher-defined page-range derivative, PDF pages ${planItem.startPage}-${planItem.endPage}. Official PDF: ${snapshot.source.officialPdfUrl}. Researcher-supplied Catalog association: NAID ${snapshot.source.naraNaid}; Opstalia did not verify that association.`,
        signal: controller.signal
      });
      if (sessionGeneration !== openGenerationRef.current) return;
      const current = projectRef.current;
      if (!current || current.id !== snapshot.id || !segmentMatchesPlan(current.segments.find((item) => item.id === planItem.segmentId), planItem)) {
        throw new Error("The reviewed range changed during export, so Opstalia discarded the derivative receipt. Export it again from the current register.");
      }
      downloadFile(planItem.fileName, result.output, "application/pdf");
      const exportedAt = new Date().toISOString();
      const receipt: PdfPacketDerivativeReceipt = {
        id: makeId("packet-derivative"),
        exportedAt,
        fileName: planItem.fileName,
        title: planItem.title,
        startPage: planItem.startPage,
        endPage: planItem.endPage,
        pageCount: planItem.pageCount,
        sourceSha256: result.sourceSha256,
        derivativeSha256: result.derivativeSha256
      };
      updateProject((currentProject) => ({
        ...currentProject,
        updatedAt: exportedAt,
        segments: currentProject.segments.map((item) => item.id === planItem.segmentId
          ? { ...item, derivativeExports: [...(item.derivativeExports ?? []), receipt].slice(-100), updatedAt: exportedAt }
          : item)
      }));
      setStatus(`Derivative downloaded from one fresh source transfer. Source SHA-256 ${result.sourceSha256}; derivative SHA-256 ${result.derivativeSha256}.`);
    } catch (cause) {
      if (sessionGeneration !== openGenerationRef.current) return;
      if (controller.signal.aborted || (cause instanceof Error && cause.name === "AbortError")) {
        setError("");
        setStatus("Derivative export cancelled. No derivative was downloaded.");
        setExportProgress(0);
      } else {
        setError(cause instanceof Error ? cause.message : "Unable to export the research derivative.");
        setStatus("");
      }
    } finally {
      if (exportControllerRef.current === controller) {
        exportingRef.current = false;
        setIsExporting(false);
        setActiveExportId(undefined);
        exportControllerRef.current = undefined;
      }
    }
  };

  const exportBatch = async () => {
    if (!project || !batchPlan || exportingRef.current) return;
    if (!batchPlan.canExport || !project.source.sha256) {
      setError("Select at least one valid, confirmed page range and reopen the official packet before exporting a batch.");
      return;
    }
    if (knownAnnotatedBatchPages.length) {
      setError(`Batch export is blocked because annotation-bearing PDF page${knownAnnotatedBatchPages.length === 1 ? "" : "s"} ${knownAnnotatedBatchPages.join(", ")} may cover underlying text.`);
      return;
    }
    if (batchWarnings.length && !allowBatchWarnings) {
      setError("Review and acknowledge the overlap or duplicate-range warnings before exporting this batch.");
      return;
    }
    setError("");
    setExportProgress(0);
    exportingRef.current = true;
    setIsExporting(true);
    setActiveExportId("batch");
    const controller = new AbortController();
    exportControllerRef.current = controller;
    const snapshot = project;
    const expectedSourceSha256 = snapshot.source.sha256!;
    const selectedSnapshot = [...selectedSegmentIds];
    const planSnapshot = createBatchExportPlan(snapshot, { selectedSegmentIds: selectedSnapshot });
    const sessionGeneration = openGenerationRef.current;
    setStatus(`Creating one fresh bounded source transfer for ${planSnapshot.derivativeItems.length} confirmed derivative${planSnapshot.derivativeItems.length === 1 ? "" : "s"}, then building a checksummed ZIP locally…`);
    try {
      const sourceBytes = await downloadFreshSourceForExport(snapshot, controller);
      const result = await createBatchDerivativesInWorker({
        sourceBytes,
        expectedSourceSha256,
        ranges: planSnapshot.derivativeItems.map((item) => ({
          segmentId: item.segmentId,
          startPage: item.startPage,
          endPage: item.endPage,
          title: item.title,
          provenance: `Researcher-defined page-range derivative, PDF pages ${item.startPage}-${item.endPage}. Official PDF: ${snapshot.source.officialPdfUrl}. Researcher-supplied Catalog association: NAID ${snapshot.source.naraNaid}; Opstalia did not verify that association.`
        })),
        signal: controller.signal
      });
      if (sessionGeneration !== openGenerationRef.current) return;
      const current = projectRef.current;
      if (
        !current ||
        current.id !== snapshot.id ||
        planSnapshot.derivativeItems.some((item) => !segmentMatchesPlan(current.segments.find((segment) => segment.id === item.segmentId), item))
      ) {
        throw new Error("The reviewed register changed during export, so Opstalia discarded the batch. Export it again from the current register.");
      }
      const packaged = await buildBatchResearchPacket(
        snapshot,
        result.outputs.map((item) => ({
          segmentId: item.segmentId,
          pdfBytes: new Uint8Array(item.output),
          expectedSha256: item.derivativeSha256
        })),
        { selectedSegmentIds: selectedSnapshot }
      );
      if (controller.signal.aborted) throw new DOMException("Batch export cancelled", "AbortError");
      const readyProject = projectRef.current;
      if (
        sessionGeneration !== openGenerationRef.current ||
        !readyProject ||
        readyProject.id !== snapshot.id ||
        readyProject.source.sha256 !== snapshot.source.sha256 ||
        planSnapshot.derivativeItems.some((item) =>
          !segmentMatchesPlan(readyProject.segments.find((segment) => segment.id === item.segmentId), item)
        )
      ) {
        throw new Error("The packet or reviewed register changed while the ZIP was being built, so Opstalia discarded it. Export again from the current register.");
      }
      const zipName = safeFilename(`${snapshot.name}-research-packet`, "zip");
      downloadFile(zipName, Uint8Array.from(packaged.zipBytes).buffer, "application/zip");
      const exportedAt = new Date().toISOString();
      const batchId = makeId("packet-batch");
      const receipts = new Map(planSnapshot.derivativeItems.map((item) => {
        const output = result.outputs.find((candidate) => candidate.segmentId === item.segmentId)!;
        return [item.segmentId, {
          id: makeId("packet-derivative"),
          exportedAt,
          batchId,
          fileName: item.fileName,
          title: item.title,
          startPage: item.startPage,
          endPage: item.endPage,
          pageCount: item.pageCount,
          sourceSha256: result.sourceSha256,
          derivativeSha256: output.derivativeSha256
        } satisfies PdfPacketDerivativeReceipt];
      }));
      updateProject((currentProject) => ({
        ...currentProject,
        updatedAt: exportedAt,
        segments: currentProject.segments.map((item) => {
          const receipt = receipts.get(item.id);
          return receipt
            ? { ...item, derivativeExports: [...(item.derivativeExports ?? []), receipt].slice(-100), updatedAt: exportedAt }
            : item;
        })
      }));
      setStatus(`Batch research packet downloaded: ${planSnapshot.derivativeItems.length} derivative PDF${planSnapshot.derivativeItems.length === 1 ? "" : "s"}, manifests, and SHA-256 checksums from one fresh official-source transfer.`);
    } catch (cause) {
      if (sessionGeneration !== openGenerationRef.current) return;
      if (controller.signal.aborted || (cause instanceof Error && cause.name === "AbortError")) {
        setError("");
        setStatus("Batch export cancelled. No research packet was downloaded.");
        setExportProgress(0);
      } else {
        setError(cause instanceof Error ? cause.message : "Unable to export the batch research packet.");
        setStatus("");
      }
    } finally {
      if (exportControllerRef.current === controller) {
        exportingRef.current = false;
        setIsExporting(false);
        setActiveExportId(undefined);
        exportControllerRef.current = undefined;
      }
    }
  };

  const saveCurrent = async () => {
    if (!project) return;
    if (project.privateMode) {
      setStatus("Private mode keeps this packet workspace in the current tab only; it was not saved.");
      return;
    }
    try {
      await savePdfPacketProject(project);
      await refreshSaved();
      setStatus("Packet register saved in this browser. No PDF bytes, page images, transport token, or extracted text were stored.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save the packet register.");
    }
  };

  return (
    <>
      <SectionHeading eyebrow="Presidential-library research workspace" title="PDF Packet Lab">
        <p>Load a bounded official NARA presidential-library PDF, search its embedded text, slice it locally into reviewed document ranges, preserve withdrawal-sheet descriptions separately, and export research derivatives.</p>
      </SectionHeading>

      <section className="security-notice packet-security-notice" aria-labelledby="packet-security-title">
        <div aria-hidden="true">!</div>
        <div>
          <h2 id="packet-security-title">Public, unclassified official copies only</h2>
          <p><strong>Do not enter or process classified information, CUI, PII, or other restricted material.</strong> The public Packet Lab accepts only a direct NARA Catalog presidential-library PDF plus a canonical NARA record locator supplied by the researcher. It is not connected to Opstalia-c or any closed network.</p>
          <p>PDF text and pages are processed in this browser. Admission reads only a short signature prefix. Opening then streams one complete approved official copy, up to 100 MB, without server-side parsing, caching, or storage. A later single or batch derivative operation streams one fresh complete copy.</p>
          <p className="fine-print">Opstalia validates the official URL forms and numeric NAID but does not establish that the supplied Catalog record lists the supplied PDF. Confirm that association on the official record page.</p>
        </div>
      </section>

      {!packetApiConfigured() && (
        <p className="error-message" role="alert">The production Worker URL is not configured in this build, so the Packet Lab cannot open official PDFs.</p>
      )}

      <div className="packet-layout">
        <aside className="packet-saved" aria-label="Saved packet registers">
          <h2>Saved packet registers</h2>
          {savedProjects.length ? savedProjects.map((saved) => (
            <article key={saved.id}>
              <strong>{saved.name}</strong>
              <small>NAID {saved.source.naraNaid} · {saved.source.pageCount} pages · {saved.segments.length} items</small>
              <div>
                <button className="text-button" disabled={isExporting} onClick={() => void openPacket(saved)}>Reopen</button>
                <button
                  className="text-button"
                  onClick={async () => {
                    if (!window.confirm(`Delete the local packet register “${saved.name}”? This does not delete the official source.`)) return;
                    await deletePdfPacketProject(saved.id);
                    await refreshSaved();
                  }}
                >Delete local register</button>
              </div>
            </article>
          )) : <p>No packet registers are saved in this browser.</p>}
        </aside>

        <section className="packet-entry" aria-labelledby="packet-entry-title">
          <header>
            <div>
              <p className="eyebrow">Step 1</p>
              <h2 id="packet-entry-title">Open an approved official packet</h2>
            </div>
            <button className="button button-secondary" onClick={fillDemo}>Use verified Bush 41 example</button>
          </header>
          <div className="packet-entry-grid">
            <label>
              <span>Packet project name</span>
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={500} placeholder="Example: CSCE briefing-book packet" />
            </label>
            <label>
              <span>NARA NAID</span>
              <input
                value={naid}
                onChange={(event) => {
                  const value = event.target.value.replace(/\D/g, "").slice(0, 20);
                  setNaid(value);
                  setRecordUrl(value ? `https://catalog.archives.gov/id/${value}` : "");
                }}
                inputMode="numeric"
                maxLength={20}
              />
            </label>
            <label className="packet-wide-field">
              <span>NARA Catalog record URL (researcher supplied)</span>
              <input value={recordUrl} onChange={(event) => setRecordUrl(event.target.value)} inputMode="url" maxLength={4096} placeholder="https://catalog.archives.gov/id/…" />
            </label>
            <label className="packet-wide-field">
              <span>Direct NARA presidential-library packet PDF</span>
              <input value={pdfUrl} onChange={(event) => setPdfUrl(event.target.value)} inputMode="url" maxLength={4096} placeholder="https://catalog.archives.gov/medialz/presidential-libraries/…pdf" />
            </label>
          </div>
          <label className="acknowledgement packet-acknowledgement">
            <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
            <span>I confirm that this is an unclassified, publicly released official copy and that I will not use the public Packet Lab for restricted material.</span>
          </label>
          <label className="private-toggle">
            <input
              type="checkbox"
              checked={privateMode}
              onChange={(event) => {
                setPrivateMode(event.target.checked);
                if (project) updateProject({ ...project, privateMode: event.target.checked });
              }}
            />
            <span><strong>Private session</strong><small>Do not save the packet register; temporary state disappears with this tab. Official network requests still occur.</small></span>
          </label>
          <button
            className="button button-primary"
            disabled={!packetApiConfigured() || loadState === "loading" || isExporting || !acknowledged}
            onClick={() => void openPacket()}
          >
            {loadState === "loading" ? "Opening official packet…" : "Open PDF Packet Lab"}
          </button>
          {loadState === "loading" && (
            <button className="text-button" onClick={() => openControllerRef.current?.abort()}>Cancel packet transfer</button>
          )}
        </section>
      </div>

      {error && <p className="error-message packet-message" role="alert">{error}</p>}
      {status && <p className="success-message packet-message" role="status" aria-live="polite">{status}</p>}
      {transferProgress && (
        <div className="packet-message" aria-label="Official packet transfer progress">
          {transferProgress.total
            ? <progress value={transferProgress.loaded} max={transferProgress.total}>{transferProgress.loaded}/{transferProgress.total}</progress>
            : <progress>Transfer in progress</progress>}
          <span>Transferring official public copy: {bytesLabel(transferProgress.loaded)}{transferProgress.total ? ` of ${bytesLabel(transferProgress.total)}` : " transferred"}</span>
        </div>
      )}

      {project && documentRef.current && (
        <>
          <section className="packet-source-bar" aria-label="Official packet provenance">
            <div>
              <p className="eyebrow">Official PDF · researcher-supplied record association</p>
              <h2>{project.name}</h2>
              <p>NAID {project.source.naraNaid} · {project.source.pageCount} PDF pages · {bytesLabel(project.source.byteLength)}</p>
              <small>Fingerprint: {project.source.sha256 ? `SHA-256 ${project.source.sha256}` : "SHA-256 unavailable; reopen the packet to compute it."}</small>
              <small>Confirm on the Catalog page that this NAID describes the linked PDF; Opstalia validates the locators but does not prove their association.</small>
            </div>
            <div>
              <ExternalLink href={project.source.officialRecordUrl!} className="button button-secondary">Catalog record</ExternalLink>
              <ExternalLink href={project.source.officialPdfUrl} className="button button-secondary">Unchanged official PDF</ExternalLink>
            </div>
          </section>

          <div className="packet-workspace">
            <section className="packet-viewer" aria-labelledby="packet-viewer-title">
              <header>
                <div>
                  <p className="eyebrow">Step 2</p>
                  <h2 id="packet-viewer-title">Review pages</h2>
                </div>
                <div className="packet-page-controls">
                  <button aria-label="Previous PDF page" disabled={currentPage <= 1} onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}>←</button>
                  <label>
                    <span>PDF page</span>
                    <input
                      type="number"
                      min="1"
                      max={project.source.pageCount}
                      value={currentPage}
                      onChange={(event) => setCurrentPage(Math.min(project.source.pageCount, Math.max(1, Number(event.target.value) || 1)))}
                    />
                  </label>
                  <span>of {project.source.pageCount}</span>
                  <button aria-label="Next PDF page" disabled={currentPage >= project.source.pageCount} onClick={() => setCurrentPage((page) => Math.min(project.source.pageCount, page + 1))}>→</button>
                  <button aria-label="Zoom out" disabled={renderScale <= 0.5} onClick={() => { setFitWidth(false); setRenderScale((scale) => Math.max(0.5, scale - 0.25)); }}>−</button>
                  <button aria-label="Fit page to viewer width" aria-pressed={fitWidth} onClick={() => { setFitWidth(true); setRenderScale(1.25); }}>Fit</button>
                  <button aria-label="Zoom in" disabled={renderScale >= 3} onClick={() => { setFitWidth(false); setRenderScale((scale) => Math.min(3, scale + 0.25)); }}>+</button>
                </div>
              </header>
              <div
                className={`packet-canvas-wrap ${fitWidth ? "packet-canvas-fit" : ""}`}
                role="region"
                tabIndex={0}
                aria-label={`Scrollable PDF page viewer, page ${currentPage} of ${project.source.pageCount}`}
                aria-describedby="packet-page-description"
              >
                <canvas ref={canvasRef} role="img" aria-label={`Rendered official PDF page ${currentPage} of ${project.source.pageCount}`} />
              </div>
              <p id="packet-page-description" className="fine-print" role="status" aria-live="polite">{pageAnnouncement}</p>
              <details className="packet-text-layer">
                <summary>Safety-checked embedded PDF text for page {currentPage}</summary>
                {currentAnnotationCount > 0 ? (
                  <p className="packet-annotation-warning" role="alert">
                    Embedded text is suppressed because this page contains {currentAnnotationCount} annotation{currentAnnotationCount === 1 ? "" : "s"}. An annotation may visually cover text that remains in the PDF data. Use the rendered page and unchanged official PDF for review.
                  </p>
                ) : (
                  <p className="fine-print">This is the PDF text layer, not new OCR. Empty or damaged text requires manual page review.</p>
                )}
                <pre>{currentText || (currentAnnotationCount ? "Text suppressed for annotation safety." : "No embedded text was available on this page.")}</pre>
              </details>
            </section>

            <aside className="packet-tools" aria-label="Packet text and range tools">
              <section>
                <p className="eyebrow">Deterministic scan</p>
                <h2>Find likely boundaries</h2>
                <p>Look for memcon, telcon, memorandum, subject, participant, date, end-marker, and withdrawal-sheet patterns. Every result is an editable suggestion.</p>
                <p className="fine-print">Per-page text is limited to {MAX_EMBEDDED_TEXT_CHARS_PER_PAGE.toLocaleString()} characters; a scan stops at {MAX_SCAN_PAGES.toLocaleString()} pages or the in-memory text budget.</p>
                <button className="button button-secondary" onClick={() => void scanText()} disabled={isScanning || isExporting}>{isScanning ? "Scanning embedded text…" : pageTexts.length ? "Rescan embedded text" : "Scan embedded text"}</button>
                {(isScanning || scanProgress > 0) && (
                  <progress value={scanProgress} max={project.source.pageCount} aria-label="PDF text scan progress">{scanProgress}/{project.source.pageCount}</progress>
                )}
                {isScanning && (
                  <button className="text-button" onClick={() => scanControllerRef.current?.abort()}>Cancel scan</button>
                )}
              </section>
              <section>
                <h2>Search scanned text</h2>
                <label>
                  <span>Words or exact phrase</span>
                  <input value={searchText} onChange={(event) => setSearchText(event.target.value)} maxLength={300} disabled={!pageTexts.length} />
                </label>
                <p>{searchText ? `${searchMatches.length} matching page${searchMatches.length === 1 ? "" : "s"}; showing ${Math.min(searchMatches.length, 40)}` : `${project.scan.pagesWithText} scanned pages with text`}</p>
                <div className="packet-search-matches">
                  {searchMatches.slice(0, 40).map((match) => (
                    <button key={match.pageNumber} onClick={() => setCurrentPage(match.pageNumber)}>
                      <strong>Page {match.pageNumber}</strong>
                      <span>{matchSnippet(match.text, searchText.trim())}</span>
                    </button>
                  ))}
                </div>
              </section>
              <section>
                <h2>Add a reviewed item</h2>
                <label>
                  <span>Evidence lane</span>
                  <select value={newKind} onChange={(event) => setNewKind(event.target.value as PdfPacketSegmentKind)}>
                    <option value="page_range">Content pages present</option>
                    <option value="described_item">Described item only</option>
                  </select>
                </label>
                <label>
                  <span>Title</span>
                  <input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} maxLength={500} />
                </label>
                {newKind === "page_range" ? (
                  <div className="packet-range-fields">
                    <label><span>Start</span><input type="number" min="1" max={project.source.pageCount} value={newStart} onChange={(event) => setNewStart(Number(event.target.value))} /></label>
                    <label><span>End</span><input type="number" min="1" max={project.source.pageCount} value={newEnd} onChange={(event) => setNewEnd(Number(event.target.value))} /></label>
                  </div>
                ) : (
                  <label><span>Extent stated on source sheet</span><input type="number" min="1" max="10000" value={newExtent} onChange={(event) => setNewExtent(event.target.value)} /></label>
                )}
                <div className="packet-current-range-actions">
                  {newKind === "page_range" && <>
                    <button className="text-button" onClick={() => setNewStart(currentPage)}>Use page {currentPage} as start</button>
                    <button className="text-button" onClick={() => setNewEnd(currentPage)}>Use page {currentPage} as end</button>
                  </>}
                </div>
                <button className="button button-primary" disabled={isExporting} onClick={addSegment}>Add reviewed item</button>
              </section>
            </aside>
          </div>

          <section className="packet-register" aria-labelledby="packet-register-title">
            <header>
              <div>
                <p className="eyebrow">Step 3</p>
                <h2 id="packet-register-title">Review the item register</h2>
                <p>{project.segments.filter((segment) => segment.reviewStatus !== "researcher_rejected").length} active items · {project.segments.filter((segment) => segment.reviewStatus === "researcher_rejected").length} rejected proposals preserved</p>
              </div>
              <div className="packet-export-actions">
                <button className="button button-primary" onClick={() => void saveCurrent()}>Save register locally</button>
                <button className="button button-secondary" onClick={() => downloadFile(safeFilename(project.name, "json"), packetManifestJson(project), "application/json")}>Manifest JSON</button>
                <button className="button button-secondary" onClick={() => downloadFile(safeFilename(project.name, "csv"), packetManifestCsv(project), "text/csv")}>Register CSV</button>
                <button
                  className="button button-secondary"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(packetManifestMarkdown(project));
                      setStatus("Markdown packet register copied.");
                    } catch {
                      setError("The browser blocked clipboard access. Use the JSON or CSV download instead.");
                    }
                  }}
                >Copy Markdown</button>
              </div>
            </header>
            <div className="packet-register-warning">
              <strong>Research derivative policy</strong>
              <p>A range is a researcher-created locator within the unchanged official packet. It is not a new official release. Each export obtains a fresh relay session and requires the source SHA-256 to match the copy opened for review. Annotation-bearing pages are refused because removing a covering annotation could reveal underlying text; annotation-free derivatives omit active page actions and are not byte-identical to the source. Described-only items never receive a derivative-PDF button.</p>
            </div>
            {batchPlan && (
              <section className="packet-batch-panel" aria-labelledby="packet-batch-title">
                <header>
                  <div>
                    <p className="eyebrow">Collection export</p>
                    <h3 id="packet-batch-title">Batch research packet</h3>
                    <p>Download the official source once, split the selected confirmed ranges locally, and receive one ZIP with numbered PDFs, JSON and CSV manifests, a README, and SHA-256 checksums.</p>
                  </div>
                  <div className="packet-batch-actions">
                    <button
                      className="text-button"
                      disabled={isExporting}
                      onClick={() => {
                        const annotationPages = project.scan.annotationPages ?? [];
                        const exportableIds = project.segments
                          .filter((segment) => {
                            if (segment.kind !== "page_range" || !segment.startPage || !segment.endPage) return false;
                            const confirmed = segment.reviewStatus === "researcher_confirmed" || segment.reviewStatus === "researcher_corrected";
                            const range = validatePageRange(segment.startPage, segment.endPage, project.source.pageCount);
                            return confirmed && range.valid && !annotationPages.some((page) => page >= segment.startPage! && page <= segment.endPage!);
                          })
                          .map((segment) => segment.id);
                        setSelectedSegmentIds(exportableIds);
                        setAllowBatchWarnings(false);
                        setStatus(`${exportableIds.length} valid confirmed range${exportableIds.length === 1 ? "" : "s"} explicitly selected for this batch.`);
                      }}
                    >Select exportable confirmed ranges</button>
                    <button
                      className="text-button"
                      disabled={isExporting || !selectedSegmentIds.length}
                      onClick={() => {
                        setSelectedSegmentIds([]);
                        setAllowBatchWarnings(false);
                        setStatus("Batch export selection cleared.");
                      }}
                    >Clear selection</button>
                  </div>
                </header>
                <dl className="packet-batch-summary">
                  <div><dt>Selected derivatives</dt><dd>{batchPlan.derivativeItems.length}</dd></div>
                  <div><dt>Selected page copies</dt><dd>{batchPlan.totalSelectedPages.toLocaleString()}</dd></div>
                  <div><dt>Unique pages covered</dt><dd>{batchPlan.uniqueCoveredPages.toLocaleString()}</dd></div>
                  <div><dt>Uncovered source ranges</dt><dd>{batchPlan.uncoveredRanges.length.toLocaleString()}</dd></div>
                  <div><dt>Described-only entries</dt><dd>{batchPlan.manifestOnlyItems.length.toLocaleString()}</dd></div>
                </dl>
                <p className="sr-only" role="status" aria-live="polite">
                  {batchPlan.derivativeItems.length} range{batchPlan.derivativeItems.length === 1 ? "" : "s"} selected for batch export.
                </p>
                <details className="packet-batch-file-plan">
                  <summary>Ordered export set: {batchPlan.derivativeItems.length} derivative PDF{batchPlan.derivativeItems.length === 1 ? "" : "s"}</summary>
                  {batchPlan.derivativeItems.length ? (
                    <ol>
                      {batchPlan.derivativeItems.map((item) => (
                        <li key={item.segmentId}>
                          <strong>{item.title}</strong> · PDF pages {item.startPage}–{item.endPage}<br />
                          <code>{item.fileName}</code>
                        </li>
                      ))}
                    </ol>
                  ) : <p>No page range is selected. Use the item checkboxes or the explicit select-all action.</p>}
                </details>
                {batchPlan.excludedPageRanges.length > 0 && (
                  <details className="packet-batch-file-plan">
                    <summary>Excluded page-range records: {batchPlan.excludedPageRanges.length}</summary>
                    <ul>
                      {batchPlan.excludedPageRanges.map((item) => (
                        <li key={item.segmentId}><strong>{item.title}</strong> · {item.reason}</li>
                      ))}
                    </ul>
                  </details>
                )}
                {batchPlan.issues.length ? (
                  <details>
                    <summary>Preflight audit: {batchErrors.length} errors, {batchWarnings.length} overlap/duplicate warnings, {batchPlan.uncoveredRanges.length} gap notices</summary>
                    <ul className="packet-preflight-issues">
                      {visibleBatchIssues.map((issue, index) => (
                        <li key={`${issue.code}-${issue.startPage ?? "none"}-${index}`} data-severity={issue.severity}>
                          <strong>{issue.severity}:</strong> {issue.message}
                        </li>
                      ))}
                    </ul>
                    {batchPlan.issues.length > visibleBatchIssues.length && <p className="fine-print">Showing every blocking error plus {Math.max(0, visibleBatchIssues.length - batchErrors.length)} of {batchPlan.issues.length - batchErrors.length} non-blocking findings.</p>}
                  </details>
                ) : <p className="success-message">Preflight found no invalid, duplicate, overlapping, or uncovered ranges.</p>}
                {knownAnnotatedBatchPages.length > 0 && (
                  <p className="packet-annotation-warning" role="alert">
                    Batch blocked: selected PDF page{knownAnnotatedBatchPages.length === 1 ? "" : "s"} {knownAnnotatedBatchPages.join(", ")} contain annotations. The isolated processor also checks every selected page before creating any derivative.
                  </p>
                )}
                {batchWarnings.length > 0 && (
                  <label className="packet-batch-confirm">
                    <input
                      type="checkbox"
                      checked={allowBatchWarnings}
                      disabled={isExporting}
                      onChange={(event) => setAllowBatchWarnings(event.target.checked)}
                    />
                    <span>I reviewed the {batchWarnings.length} overlap or duplicate-range warning{batchWarnings.length === 1 ? "" : "s"} and intend to include these page copies.</span>
                  </label>
                )}
                <div className="packet-batch-actions">
                  <button
                    className="button button-primary"
                    aria-describedby="packet-batch-export-help"
                    disabled={
                      isExporting ||
                      !acknowledged ||
                      !batchPlan.canExport ||
                      knownAnnotatedBatchPages.length > 0 ||
                      (batchWarnings.length > 0 && !allowBatchWarnings)
                    }
                    onClick={() => void exportBatch()}
                  >
                    {activeExportId === "batch" ? "Building research packet…" : `Export ${batchPlan.derivativeItems.length} selected range${batchPlan.derivativeItems.length === 1 ? "" : "s"} as ZIP`}
                  </button>
                  {activeExportId === "batch" && (
                    <button className="text-button" onClick={() => exportControllerRef.current?.abort()}>
                      Cancel batch export
                    </button>
                  )}
                  <span id="packet-batch-export-help" className="fine-print">{batchExportHelp} Maximum 200 derivatives, 5,000 selected page copies, 200 MB of derivative PDFs, and a 100 MB official source.</span>
                </div>
              </section>
            )}
            {project.segments.length ? project.segments.map((segment) => (
              <SegmentCard
                key={segment.id}
                project={project}
                segment={segment}
                onChange={(next) => {
                  const stillExportable = next.kind === "page_range" && (
                    next.reviewStatus === "researcher_confirmed" || next.reviewStatus === "researcher_corrected"
                  ) && !project.scan.annotationPages?.some(
                    (page) => Boolean(next.startPage && next.endPage && page >= next.startPage && page <= next.endPage)
                  );
                  if (!stillExportable) {
                    setSelectedSegmentIds((current) => current.filter((id) => id !== next.id));
                    if (selectedSegmentIds.includes(next.id)) {
                      setStatus(`${next.title} was removed from the batch because it is no longer exportable.`);
                    }
                  }
                  setAllowBatchWarnings(false);
                  updateProject({
                    ...project,
                    updatedAt: new Date().toISOString(),
                    segments: project.segments.map((item) => item.id === next.id ? next : item)
                  });
                }}
                onNavigate={setCurrentPage}
                onExport={(item) => void exportDerivative(item)}
                onCancelExport={() => exportControllerRef.current?.abort()}
                exportBusy={isExporting}
                exportActive={activeExportId === segment.id}
                selectedForBatch={selectedSegmentIds.includes(segment.id)}
                onBatchSelection={(selected) => {
                  setSelectedSegmentIds((current) => selected
                    ? [...new Set([...current, segment.id])]
                    : current.filter((id) => id !== segment.id));
                  setAllowBatchWarnings(false);
                  setStatus(`${segment.title} ${selected ? "added to" : "removed from"} the batch export selection.`);
                }}
              />
            )) : <p className="empty-state">No item ranges yet. Add one manually or scan the PDF text for suggestions.</p>}
            {exportProgress > 0 && project.source.byteLength && (
              <div>
                <progress value={exportProgress} max={project.source.byteLength} aria-label="Source download progress for derivative export">
                  {bytesLabel(exportProgress)} of {bytesLabel(project.source.byteLength)}
                </progress>
              </div>
            )}
            <p id="packet-export-limit" className="fine-print"><strong>Browser safety limit:</strong> the public Packet Lab admits official PDFs up to 100 MB. Opening and derivative export each transfer the complete official source into browser memory; low-memory devices may fail sooner.</p>
          </section>
        </>
      )}
    </>
  );
}
