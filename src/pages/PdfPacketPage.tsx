import { useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import type { PdfPacketProject, PdfPacketSegment, PdfPacketSegmentKind } from "../core/types";
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
  createDerivativeInWorker,
  downloadBoundedSourcePdf,
  extractEmbeddedPageText,
  MAX_EMBEDDED_TEXT_CHARS_PER_PAGE,
  openOfficialPdf,
  renderOfficialPdfPage
} from "../pdf/pdf-engine";
import { pageRangeLabel, validatePageRange } from "../pdf/page-ranges";
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

function SegmentCard({
  project,
  segment,
  onChange,
  onNavigate,
  onExport,
  exportBusy
}: {
  project: PdfPacketProject;
  segment: PdfPacketSegment;
  onChange: (segment: PdfPacketSegment) => void;
  onNavigate: (page: number) => void;
  onExport: (segment: PdfPacketSegment) => void;
  exportBusy: boolean;
}) {
  const rejected = segment.reviewStatus === "researcher_rejected";
  const confirmed = segment.reviewStatus === "researcher_confirmed" || segment.reviewStatus === "researcher_corrected";
  const exportAvailable = Boolean(
    project.source.byteLength && project.source.byteLength <= MAX_BROWSER_DERIVATIVE_SOURCE_BYTES
  );
  const update = (changes: Partial<PdfPacketSegment>) => onChange({
    ...segment,
    ...changes,
    reviewStatus: changes.reviewStatus ?? (segment.detectionMethod === "pattern_match" ? "researcher_corrected" : segment.reviewStatus),
    updatedAt: new Date().toISOString()
  });
  return (
    <article className={`packet-segment ${rejected ? "packet-segment-rejected" : ""}`}>
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
          disabled={rejected}
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
              disabled={rejected}
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
              disabled={rejected}
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
              disabled={rejected}
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
              disabled={rejected}
              onChange={(event) => update({ evidencePages: Number(event.target.value) ? [Number(event.target.value)] : [], confidence: 1 })}
            />
          </label>
          <p>No content-page range is claimed.</p>
        </div>
      )}
      <details>
        <summary>Basis and proposal reasons</summary>
        <p>{segment.releaseStatus.determinationBasis}</p>
        <ul>{segment.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        <p className="fine-print">Public visibility and absence of obvious redactions do not establish release in full.</p>
      </details>
      <div className="packet-segment-actions">
        {segment.startPage && <button className="button button-secondary" onClick={() => onNavigate(segment.startPage!)}>View start page</button>}
        {segment.evidencePages?.[0] && <button className="button button-secondary" onClick={() => onNavigate(segment.evidencePages![0])}>View evidence page</button>}
        {!rejected && (
          <button
            className="button button-secondary"
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
            disabled={!confirmed || rejected || !exportAvailable || exportBusy}
            aria-describedby={!exportAvailable ? "packet-export-limit" : undefined}
            title={!exportAvailable
              ? "Page-range derivative export is limited to source PDFs no larger than 100 MB"
              : confirmed ? "Create a research derivative from the confirmed page range" : "Confirm the range before exporting"}
            onClick={() => onExport(segment)}
          >
            {exportBusy ? "Derivative export in progress…" : "Export derivative PDF"}
          </button>
        )}
        <button
          className="text-button"
          aria-pressed={rejected}
          onClick={() => update({
            reviewStatus: rejected ? "proposed" : "researcher_rejected",
            reasons: [...new Set([...segment.reasons, rejected ? "Proposal restored for review" : "Proposal rejected by researcher"])]
          })}
        >
          {rejected ? "Restore proposal" : "Reject proposal"}
        </button>
      </div>
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
  const [pageTexts, setPageTexts] = useState<PacketPageText[]>([]);
  const [searchText, setSearchText] = useState("");
  const [loadState, setLoadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [scanProgress, setScanProgress] = useState(0);
  const [exportProgress, setExportProgress] = useState(0);
  const [isScanning, setIsScanning] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [renderScale, setRenderScale] = useState(1.25);
  const [fitWidth, setFitWidth] = useState(true);
  const [pageAnnouncement, setPageAnnouncement] = useState("");
  const [transferProgress, setTransferProgress] = useState<{ loaded: number; total?: number }>();
  const [newKind, setNewKind] = useState<PdfPacketSegmentKind>("page_range");
  const [newTitle, setNewTitle] = useState("");
  const [newStart, setNewStart] = useState(1);
  const [newEnd, setNewEnd] = useState(1);
  const [newExtent, setNewExtent] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const documentRef = useRef<PDFDocumentProxy | undefined>(undefined);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | undefined>(undefined);
  const contentUrlRef = useRef("");
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
        const text = await extractEmbeddedPageText(activeDocument, pageNumber);
        if (controller.signal.aborted || currentPageRef.current !== pageNumber || openGenerationRef.current !== sessionGeneration) return;
        setCurrentText(text);
        setPageAnnouncement(
          `PDF page ${pageNumber} of ${project.source.pageCount} rendered. ${text ? "Embedded text is available below." : "No embedded text was available; review the page image manually."}`
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

  const fillDemo = () => {
    setName(DEMO.title);
    setNaid(DEMO.naid);
    setRecordUrl(DEMO.recordUrl);
    setPdfUrl(DEMO.pdfUrl);
    setError("");
  };

  const openPacket = async (preset?: PdfPacketProject) => {
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
    contentUrlRef.current = "";
    renderControllerRef.current?.abort();
    scanControllerRef.current?.abort();
    exportControllerRef.current?.abort();
    exportingRef.current = false;
    setIsScanning(false);
    setIsExporting(false);
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
      contentUrlRef.current = session.contentUrl;
      const now = new Date().toISOString();
      const sourceUnchanged = Boolean(
        preset &&
        preset.source.byteLength === opened.byteLength &&
        preset.source.sha256 &&
        preset.source.sha256 === opened.sha256
      );
      const next: PdfPacketProject = preset
        ? {
            ...preset,
            privateMode,
            updatedAt: now,
            source: {
              ...preset.source,
              sha256: opened.sha256,
              pageCount: opened.document.numPages,
              byteLength: opened.byteLength,
              etag: session.etag,
              lastModified: session.lastModified,
              inspectedAt: now
            },
            segments: sourceUnchanged ? preset.segments : preset.segments.map((segment) => ({
              ...segment,
              notes: removeStaleDerivativeHash(segment.notes),
              reviewStatus: segment.reviewStatus === "researcher_rejected" ? "researcher_rejected" as const : "proposed" as const,
              reasons: [...new Set([...segment.reasons, "The newly computed source hash did not match a saved hash; re-review required"])],
              updatedAt: now
            }))
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
            scan: { pagesScanned: 0, pagesWithText: 0 }
          };
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
      setLoadState("ready");
      setTransferProgress(undefined);
      setStatus(
        `${sourceUnchanged || !preset ? "Ready" : "Ready; saved range decisions require re-review because the newly computed source hash did not match a saved hash"}: ${opened.document.numPages} pages, ${bytesLabel(opened.byteLength)}. The original remains NARA-hosted; one bounded public copy transited the relay and is processed transiently in this browser.`
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
      return typeof update === "function" ? update(current) : update;
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
    let totalTextCharacters = 0;
    let limitedReason: string | undefined;
    try {
      const pageLimit = Math.min(project.source.pageCount, MAX_SCAN_PAGES);
      for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
        if (controller.signal.aborted) throw new DOMException("Scan cancelled", "AbortError");
        const text = await extractEmbeddedPageText(documentRef.current, pageNumber);
        if (totalTextCharacters + text.length > MAX_SCAN_TEXT_CHARS) {
          limitedReason = `The in-memory scan stopped before PDF page ${pageNumber} at the ${Math.floor(MAX_SCAN_TEXT_CHARS / 1024 / 1024)} million-character safety budget.`;
          break;
        }
        pages.push({ pageNumber, text });
        totalTextCharacters += text.length;
        setScanProgress(pageNumber);
        if (pageNumber % 4 === 0) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      if (!limitedReason && project.source.pageCount > MAX_SCAN_PAGES) {
        limitedReason = `The deterministic scan stopped after ${MAX_SCAN_PAGES.toLocaleString()} pages; later pages remain available for manual review.`;
      }
      const proposals = proposePacketSegments(pages, pages.length);
      const withText = pages.filter((page) => page.text.length > 0).length;
      setPageTexts(pages);
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
          completedAt: limitedReason ? undefined : new Date().toISOString(),
          limitedReason
        }
      }));
      setStatus(
        `Scanned ${pages.length} pages; ${withText} contained embedded text. Added ${proposals.length} editable boundary suggestion${proposals.length === 1 ? "" : "s"}.${limitedReason ? ` ${limitedReason}` : ""}`
      );
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") setStatus("Text scan cancelled.");
      else setError(cause instanceof Error ? cause.message : "The embedded-text scan failed.");
    } finally {
      setIsScanning(false);
    }
  };

  const addSegment = () => {
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

  const exportDerivative = async (segment: PdfPacketSegment) => {
    if (!project || segment.kind !== "page_range" || !segment.startPage || !segment.endPage || exportingRef.current) return;
    const range = validatePageRange(segment.startPage, segment.endPage, project.source.pageCount);
    if (!range.valid) {
      setError(range.reason);
      return;
    }
    setError("");
    setExportProgress(0);
    exportingRef.current = true;
    setIsExporting(true);
    const controller = new AbortController();
    exportControllerRef.current = controller;
    const projectId = project.id;
    const sessionGeneration = openGenerationRef.current;
    setStatus("Downloading a second complete bounded source copy, then extracting the confirmed page range in an isolated browser worker…");
    try {
      const sourceBytes = await downloadBoundedSourcePdf(
        contentUrlRef.current,
        project.source.byteLength ?? Number.POSITIVE_INFINITY,
        (loaded) => setExportProgress(loaded),
        controller.signal
      );
      const result = await createDerivativeInWorker({
        sourceBytes,
        startPage: segment.startPage,
        endPage: segment.endPage,
        title: segment.title,
        provenance: `Researcher-defined page-range derivative, PDF pages ${segment.startPage}-${segment.endPage}. Official PDF: ${project.source.officialPdfUrl}. Researcher-supplied Catalog association: NAID ${project.source.naraNaid}; Opstalia did not verify that association.`,
        signal: controller.signal
      });
      if (sessionGeneration !== openGenerationRef.current) return;
      if (project.source.sha256 && result.sourceSha256 !== project.source.sha256) {
        throw new Error("The official source hash changed after this packet was opened. Reopen and review the packet before exporting a derivative.");
      }
      downloadFile(safeFilename(segment.title, "pdf"), result.output, "application/pdf");
      setProject((current) => {
        if (!current || current.id !== projectId) return current;
        const updatedAt = new Date().toISOString();
        return {
          ...current,
          updatedAt,
          source: { ...current.source, sha256: result.sourceSha256 },
          segments: current.segments.map((item) => item.id === segment.id
            ? {
                ...item,
                notes: `${item.notes ? `${item.notes}\n` : ""}Latest derivative SHA-256: ${result.derivativeSha256} (source SHA-256: ${result.sourceSha256})`,
                updatedAt
              }
            : item)
        };
      });
      setStatus(`Derivative downloaded. Source SHA-256 ${result.sourceSha256}; derivative SHA-256 ${result.derivativeSha256}.`);
    } catch (cause) {
      if (sessionGeneration !== openGenerationRef.current) return;
      setError(cause instanceof Error ? cause.message : "Unable to export the research derivative.");
      setStatus("");
    } finally {
      if (exportControllerRef.current === controller) {
        exportingRef.current = false;
        setIsExporting(false);
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
          <p>PDF text and pages are processed in this browser. Admission reads only a short signature prefix. Opening then streams one complete approved official copy, up to 100 MB, without server-side parsing, caching, or storage. Creating a derivative may stream the complete source a second time.</p>
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
                <button className="text-button" onClick={() => void openPacket(saved)}>Reopen</button>
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
            disabled={!packetApiConfigured() || loadState === "loading" || !acknowledged}
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
                <summary>Embedded PDF text for page {currentPage}</summary>
                <p className="fine-print">This is the PDF text layer, not new OCR. Empty or damaged text requires manual page review.</p>
                <pre>{currentText || "No embedded text was available on this page."}</pre>
              </details>
            </section>

            <aside className="packet-tools" aria-label="Packet text and range tools">
              <section>
                <p className="eyebrow">Deterministic scan</p>
                <h2>Find likely boundaries</h2>
                <p>Look for memcon, telcon, memorandum, subject, participant, date, end-marker, and withdrawal-sheet patterns. Every result is an editable suggestion.</p>
                <p className="fine-print">Per-page text is limited to {MAX_EMBEDDED_TEXT_CHARS_PER_PAGE.toLocaleString()} characters; a scan stops at {MAX_SCAN_PAGES.toLocaleString()} pages or the in-memory text budget.</p>
                <button className="button button-secondary" onClick={() => void scanText()} disabled={isScanning}>{isScanning ? "Scanning embedded text…" : pageTexts.length ? "Rescan embedded text" : "Scan embedded text"}</button>
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
                <button className="button button-primary" onClick={addSegment}>Add reviewed item</button>
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
              <p>A range is a researcher-created locator within the unchanged official packet. It is not a new official release. Creating a derivative transfers the complete source again and requires its SHA-256 to match the copy opened for review. For safety, derivative PDFs omit active page actions and annotations and are not byte-identical to the source. Described-only items never receive a derivative-PDF button.</p>
            </div>
            {project.segments.length ? project.segments.map((segment) => (
              <SegmentCard
                key={segment.id}
                project={project}
                segment={segment}
                onChange={(next) => updateProject({
                  ...project,
                  updatedAt: new Date().toISOString(),
                  segments: project.segments.map((item) => item.id === next.id ? next : item)
                })}
                onNavigate={setCurrentPage}
                onExport={(item) => void exportDerivative(item)}
                exportBusy={isExporting}
              />
            )) : <p className="empty-state">No item ranges yet. Add one manually or scan the PDF text for suggestions.</p>}
            {exportProgress > 0 && project.source.byteLength && (
              <div>
                <progress value={exportProgress} max={project.source.byteLength} aria-label="Source download progress for derivative export">
                  {bytesLabel(exportProgress)} of {bytesLabel(project.source.byteLength)}
                </progress>
                {isExporting && <button className="text-button" onClick={() => exportControllerRef.current?.abort()}>Cancel derivative export</button>}
              </div>
            )}
            <p id="packet-export-limit" className="fine-print"><strong>Browser safety limit:</strong> the public Packet Lab admits official PDFs up to 100 MB. Opening and derivative export each transfer the complete official source into browser memory; low-memory devices may fail sooner.</p>
          </section>
        </>
      )}
    </>
  );
}
