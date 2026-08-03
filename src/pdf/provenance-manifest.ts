import type { PdfPacketProject, PdfPacketSegment } from "../core/types";
import { pageRangeLabel } from "./page-ranges";

function csvCell(value: unknown): string {
  let text = value === undefined || value === null ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function packetManifest(project: PdfPacketProject): Record<string, unknown> {
  return {
    schema: "opstalia-pdf-packet-manifest/1.0",
    generatedAt: new Date().toISOString(),
    warning: "Research derivatives are not official source files. Official source records and agency determinations control.",
    officialSource: {
      sourceId: project.source.sourceId,
      officialPdfUrl: project.source.officialPdfUrl,
      etag: project.source.etag,
      lastModified: project.source.lastModified,
      byteLength: project.source.byteLength
    },
    researcherSuppliedAssociation: {
      officialRecordUrl: project.source.officialRecordUrl,
      naraNaid: project.source.naraNaid,
      associationVerifiedByOpstalia: false,
      caution: "Opstalia validates the official URL forms but does not establish that the supplied Catalog record lists the supplied PDF."
    },
    opstaliaExtracted: {
      pdfPageCount: project.source.pageCount,
      sourceSha256: project.source.sha256,
      pagesScanned: project.scan.pagesScanned,
      pagesWithEmbeddedText: project.scan.pagesWithText
    },
    researcherWork: {
      projectName: project.name,
      notes: project.notes,
      segments: project.segments
    },
    unknownOrUnavailable: [
      "Whether the packet is complete",
      "Whether the researcher-supplied Catalog record lists this PDF",
      "Whether every page is declassified",
      "Whether a page range is an official standalone document",
      "Text not present in the PDF text layer"
    ]
  };
}

export function packetManifestJson(project: PdfPacketProject): string {
  return `${JSON.stringify(packetManifest(project), null, 2)}\n`;
}

export function packetManifestCsv(project: PdfPacketProject): string {
  const header = [
    "segment_id",
    "kind",
    "title",
    "pdf_start_page",
    "pdf_end_page",
    "evidence_pages",
    "described_extent",
    "date",
    "document_type",
    "identifier",
    "release_status",
    "determination_basis",
    "detection_method",
    "confidence",
    "review_status",
    "nara_naid",
    "official_record_url",
    "official_pdf_url",
    "source_sha256"
  ];
  const rows = project.segments.map((segment) => [
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
    segment.releaseStatus.status,
    segment.releaseStatus.determinationBasis,
    segment.detectionMethod,
    segment.confidence,
    segment.reviewStatus,
    project.source.naraNaid,
    project.source.officialRecordUrl,
    project.source.officialPdfUrl,
    project.source.sha256
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

function segmentCitation(project: PdfPacketProject, segment: PdfPacketSegment): string {
  const location = segment.kind === "page_range" && segment.startPage && segment.endPage
    ? pageRangeLabel({ startPage: segment.startPage, endPage: segment.endPage })
    : `withdrawal/finding-aid description; evidence on PDF page${segment.evidencePages?.length === 1 ? "" : "s"} ${segment.evidencePages?.join(", ") ?? "not recorded"}`;
  return `Official NARA-hosted PDF, ${location}. Researcher-supplied Catalog association: NAID ${project.source.naraNaid ?? "not recorded"} (not verified by Opstalia).`;
}

export function packetManifestMarkdown(project: PdfPacketProject): string {
  const segments = project.segments.map((segment, index) => [
    `### ${index + 1}. ${segment.title}`,
    "",
    `- Evidence lane: ${segment.kind === "page_range" ? "Researcher-defined page range" : "Described item only"}`,
    `- Locator: ${segmentCitation(project, segment)}`,
    `- Release status: ${segment.releaseStatus.status}`,
    `- Determination basis: ${segment.releaseStatus.determinationBasis}`,
    `- Detection/review: ${segment.detectionMethod}; ${segment.reviewStatus}; confidence ${Math.round(segment.confidence * 100)}%`,
    `- Reasons: ${segment.reasons.join("; ") || "Researcher-defined"}`
  ].join("\n")).join("\n\n");
  return [
    `# ${project.name}`,
    "",
    "> Research derivative — not an official source file. Official source records and agency determinations control.",
    "",
    `- Researcher-supplied NARA NAID: ${project.source.naraNaid ?? "Not recorded"}`,
    `- Researcher-supplied official record locator: ${project.source.officialRecordUrl ?? "Not recorded"}`,
    "- PDF/record association verified by Opstalia: No; confirm it on the official Catalog page",
    `- Official packet: ${project.source.officialPdfUrl}`,
    `- PDF pages: ${project.source.pageCount}`,
    `- Source SHA-256: ${project.source.sha256 ?? "Not computed; the original packet was not fully downloaded"}`,
    "",
    segments || "No page ranges or described items have been recorded.",
    "",
    "## Caveats",
    "",
    "A page range is a researcher-created locator, not proof of an official standalone release. More visible text does not establish authenticity, completeness, or release in full. Described-only items do not have exportable content pages. Active page actions and annotations are removed from derivative PDFs for safety, so a derivative is not byte-identical to the source pages."
  ].join("\n") + "\n";
}
