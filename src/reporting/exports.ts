import type { ExportReport, NormalizedRecord, SearchProject } from "../core/types";
import { sanitizeProjectForPersistence } from "../persistence/database";

export const STANDARD_CAVEATS = [
  "Absence of a search result does not establish that a document has never been released.",
  "Government search systems may be incomplete, unindexed, temporarily unavailable, or limited to metadata.",
  "Different agencies may release different versions of the same record.",
  "A record may be publicly accessible without being discoverable through an API.",
  "Declassified and publicly available online are not synonymous.",
  "A document may be declassified but not digitized.",
  "A document may be released in part while retaining classified or otherwise exempt information.",
  "Redaction detection is probabilistic and requires human review.",
  "Opstalia does not make classification, declassification, legal, or disclosure determinations.",
  "Official source records and agency determinations control."
];

function current<T>(field?: { value: T; researcherOverride?: { value: T } }): T | undefined {
  return field?.researcherOverride?.value ?? field?.value;
}

function recordMarkdown(record: NormalizedRecord, number: number): string {
  const factors = record.matchExplanation.map((factor) => `  - ${factor.points >= 0 ? "+" : ""}${factor.points} ${factor.label}: ${factor.detail}`).join("\n");
  return [
    `### ${number}. ${current(record.title)}`,
    "",
    `- Official source: ${current(record.sourceRepository)}`,
    `- Official URL: ${current(record.officialUrl)}`,
    `- Date: ${current(record.date) ?? "Unknown"}`,
    `- Release status: \`${record.review.releaseStatusOverride?.status ?? record.releaseStatus.status}\``,
    `- Determination basis: ${record.review.releaseStatusOverride?.determinationBasis ?? record.releaseStatus.determinationBasis}`,
    `- Match score: ${record.confidenceScore}/100`,
    `- Provenance: ${record.provenance.adapterId}; retrieved ${record.retrievalTimestamp}`,
    `- Visible exemption codes: ${record.exemptionCodes.join(", ") || "None reported or detected"}`,
    "",
    "Why this matched:",
    factors || "  - No positive scoring factor recorded.",
    "",
    `Researcher review: ${record.review.disposition}${record.review.basis ? ` — ${record.review.basis}` : ""}`
  ].join("\n");
}

export function createExportReport(project: SearchProject): ExportReport {
  const exportSafeProject = sanitizeProjectForPersistence(project);
  const bestCandidate = [...exportSafeProject.records].sort((left, right) => right.confidenceScore - left.confidenceScore)[0];
  return {
    generatedAt: new Date().toISOString(),
    project: exportSafeProject,
    bestCandidateId: bestCandidate?.id,
    caveats: STANDARD_CAVEATS,
    factLegend: {
      source_reported: "Fact directly supplied by an official source",
      extracted: "Data extracted or normalized by Opstalia",
      inferred: "Opstalia inference requiring human review",
      unknown: "Unknown or unavailable information",
      researcher: "Researcher-confirmed or researcher-corrected information"
    }
  };
}

export function projectToMarkdown(project: SearchProject): string {
  const report = createExportReport(project);
  const exportProject = report.project;
  const sourceRuns = exportProject.sourceRuns
    .map((run) => `- ${run.sourceId}: ${run.status} (${run.resultCount} results)${run.message ? ` — ${run.message}` : ""}`)
    .join("\n");
  const queries = exportProject.plan.queries.filter((query) => query.enabled).map((query) => `- [${query.kind}] ${query.text}`).join("\n");
  const groups = exportProject.versionGroups
    .map((group) => `- ${group.label}: ${group.recordIds.length} records; ${group.reviewStatus}`)
    .join("\n");
  return [
    `# Opstalia research report: ${exportProject.name}`,
    "",
    `Generated: ${report.generatedAt}`,
    `Project created: ${exportProject.createdAt}`,
    `Private mode: ${exportProject.privateMode ? "Yes — this project was not persisted by Opstalia" : "No"}`,
    "",
    "## Security boundary",
    "",
    "This report was produced from unclassified metadata and publicly available official-source records. Opstalia 1.0 is an unclassified Internet application and is not connected to Opstalia-c or any closed network.",
    "",
    "## Search target",
    "",
    "```json",
    JSON.stringify(exportProject.target, null, 2),
    "```",
    "",
    "## Search terms used",
    "",
    queries || "- None",
    "",
    "## Sources searched",
    "",
    sourceRuns || "- None",
    "",
    "## Results",
    "",
    ...exportProject.records.map(recordMarkdown),
    "",
    "## Likely version groups",
    "",
    groups || "- No likely version group generated.",
    "",
    "## Important caveats",
    "",
    ...report.caveats.map((caveat) => `- ${caveat}`),
    "",
    "## Evidence legend",
    "",
    ...Object.entries(report.factLegend).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Suggested next actions",
    "",
    "- Open the best candidate on its official source page and verify the current record.",
    "- Review source notes, withdrawal sheets, page counts, and attachments manually.",
    "- Run official manual-search adapters for unavailable repositories.",
    "- Record the basis for any match, version, or release-status conclusion."
  ].join("\n");
}

function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function projectToCsv(project: SearchProject): string {
  const exportProject = sanitizeProjectForPersistence(project);
  const header = [
    "opstalia_id",
    "title",
    "date",
    "source_repository",
    "official_url",
    "naid",
    "document_number",
    "case_number",
    "release_status",
    "determination_basis",
    "exemption_codes",
    "match_score",
    "review_disposition",
    "provenance_adapter",
    "retrieved_at"
  ];
  const rows = exportProject.records.map((record) => [
    record.id,
    current(record.title),
    current(record.date),
    current(record.sourceRepository),
    current(record.officialUrl),
    current(record.naraNaid),
    current(record.documentNumber),
    current(record.caseNumber),
    record.review.releaseStatusOverride?.status ?? record.releaseStatus.status,
    record.review.releaseStatusOverride?.determinationBasis ?? record.releaseStatus.determinationBasis,
    record.exemptionCodes.join("; "),
    record.confidenceScore,
    record.review.disposition,
    record.provenance.adapterId,
    record.retrievalTimestamp
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function projectToJson(project: SearchProject): string {
  return JSON.stringify(
    { schema: "opstalia-project-1.0", exportedAt: new Date().toISOString(), ...sanitizeProjectForPersistence(project) },
    null,
    2
  );
}

export function projectToPrintableHtml(project: SearchProject): string {
  const markdown = projectToMarkdown(project);
  const escaped = markdown.replace(/[&<>]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character] ?? character);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Opstalia report</title><style>body{font-family:Georgia,serif;max-width:850px;margin:2rem auto;line-height:1.5;color:#111}pre{white-space:pre-wrap}@media print{body{margin:0}}</style></head><body><pre>${escaped}</pre></body></html>`;
}

export function downloadText(filename: string, content: string, mediaType: string): void {
  const blob = new Blob([content], { type: `${mediaType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
