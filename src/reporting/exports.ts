import type { ExportReport, NormalizedRecord, SearchProject } from "../core/types";
import { sanitizeProjectForPersistence } from "../persistence/database";
import { getSource } from "../data/registry";

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

function markdownText(value: unknown): string {
  return String(value ?? "")
    .replace(/[\r\n\u2028\u2029]+/g, " ")
    // Markdown exports are rendered by downstream tools; remove non-printing controls.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/([`*_{}[\]()|])/g, "\\$1");
}

function markdownUrl(value: unknown): string {
  try {
    const url = new URL(String(value));
    return `<${url.href.replace(/</g, "%3C").replace(/>/g, "%3E")}>`;
  } catch {
    return markdownText(value);
  }
}

function jsonCodeBlock(value: unknown): string {
  const json = (JSON.stringify(value, null, 2) ?? "null")
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");
  const longestBacktickRun = Math.max(
    0,
    ...(json.match(/`+/g) ?? []).map((run) => run.length)
  );
  const fence = "`".repeat(Math.max(3, longestBacktickRun + 1));
  return `${fence}json\n${json}\n${fence}`;
}

function recordMarkdown(record: NormalizedRecord, number: number): string {
  const factors = record.matchExplanation.map((factor) => `  - ${factor.points >= 0 ? "+" : ""}${factor.points} ${markdownText(factor.label)}: ${markdownText(factor.detail)}`).join("\n");
  const isResearcherLocator = record.provenance.normalizationVersion.includes("researcher-locator");
  const provenanceSummary = record.provenance.importedUnverified
    ? `imported ${record.retrievalTimestamp}; official-domain checked, but source retrieval and provenance were not revalidated`
    : `${isResearcherLocator ? "locator recorded" : "retrieved"} ${record.retrievalTimestamp}`;
  return [
    `### ${number}. ${markdownText(current(record.title))}`,
    "",
    `- Official source: ${markdownText(current(record.sourceRepository))}`,
    `- Official URL: ${markdownUrl(current(record.officialUrl))}`,
    `- Date: ${markdownText(current(record.date) ?? "Unknown")}`,
    `- Release status: \`${record.review.releaseStatusOverride?.status ?? record.releaseStatus.status}\``,
    `- Determination basis: ${markdownText(record.review.releaseStatusOverride?.determinationBasis ?? record.releaseStatus.determinationBasis)}`,
    `- Match score: ${record.confidenceScore}/100`,
    `- Provenance: ${markdownText(record.provenance.adapterId)}; ${markdownText(provenanceSummary)}`,
    `- Visible exemption codes: ${record.exemptionCodes.length ? record.exemptionCodes.map(markdownText).join(", ") : "None reported or detected"}`,
    "",
    "Why this matched:",
    factors || "  - No positive scoring factor recorded.",
    "",
    `Researcher review: ${record.review.disposition}${record.review.basis ? ` — ${markdownText(record.review.basis)}` : ""}`
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
  const automatedRuns = exportProject.sourceRuns
    .filter((run) => {
      const source = getSource(run.sourceId);
      return (
        !run.manualHandoff &&
        run.status !== "manual_available" &&
        source?.searchCapability !== "manual" &&
        !["temporarily_unavailable", "blocked", "cancelled"].includes(run.status)
      );
    })
    .map((run) => `- ${markdownText(run.sourceId)}: ${run.status} (${run.resultCount} results)${run.message ? ` — ${markdownText(run.message)}` : ""}`)
    .join("\n");
  const manualHandoffs = exportProject.sourceRuns
    .filter((run) => {
      const source = getSource(run.sourceId);
      return (
        !["temporarily_unavailable", "blocked", "cancelled"].includes(run.status) &&
        (
          (run.manualHandoff && run.manualHandoff.status !== "unavailable") ||
          (!run.manualHandoff && (run.status === "manual_available" || source?.searchCapability === "manual"))
        )
      );
    })
    .map((run) => {
      const handoff = run.manualHandoff;
      if (!handoff) {
        return [
          `- ${markdownText(run.sourceId)}: manual link available; ${run.resultCount} researcher-recorded locator${run.resultCount === 1 ? "" : "s"}`,
          `  - Official handoff: ${run.manualSearchUrl ? markdownUrl(run.manualSearchUrl) : "Unavailable"}`,
          "  - Caveat: Legacy saved run; no prepared handoff worksheet was stored."
        ].join("\n");
      }
      const filters = Object.entries(handoff.appliedFilters)
        .map(([label, value]) => `  - ${markdownText(label)}: ${markdownText(value)}`)
        .join("\n");
      return [
        `- ${markdownText(run.sourceId)}: ${handoff.status}; ${run.resultCount} researcher-recorded locator${run.resultCount === 1 ? "" : "s"}`,
        `  - Search text: ${markdownText(handoff.queryText || "None")}`,
        `  - Official handoff: ${handoff.queryUrl ? markdownUrl(handoff.queryUrl) : run.manualSearchUrl ? markdownUrl(run.manualSearchUrl) : "Unavailable"}`,
        filters,
        ...handoff.warnings.map((warning) => `  - Caveat: ${markdownText(warning)}`)
      ].filter(Boolean).join("\n");
    })
    .join("\n");
  const unavailableRuns = exportProject.sourceRuns
    .filter(
      (run) =>
        ["temporarily_unavailable", "blocked", "cancelled"].includes(run.status) ||
        run.manualHandoff?.status === "unavailable"
    )
    .map((run) => {
      const handoff = run.manualHandoff;
      return [
        `- ${markdownText(run.sourceId)}: ${run.status}${run.message ? ` — ${markdownText(run.message)}` : ""}`,
        handoff?.queryText ? `  - Prepared retry text: ${markdownText(handoff.queryText)}` : "",
        handoff?.queryUrl ? `  - Official retry: ${markdownUrl(handoff.queryUrl)}` : "",
        run.resultCount
          ? `  - Researcher-recorded locators: ${run.resultCount} (this does not mean the unavailable source was searched)`
          : "",
        ...(handoff?.warnings.map((warning) => `  - Caveat: ${markdownText(warning)}`) ?? [])
      ].filter(Boolean).join("\n");
    })
    .join("\n");
  const queries = exportProject.plan.queries.filter((query) => query.enabled).map((query) => `- [${query.kind}] ${markdownText(query.text)}`).join("\n");
  const groups = exportProject.versionGroups
    .map((group) => `- ${markdownText(group.label)}: ${group.recordIds.length} records; ${group.reviewStatus}`)
    .join("\n");
  return [
    `# Opstalia research report: ${markdownText(exportProject.name)}`,
    "",
    `Generated: ${report.generatedAt}`,
    `Project created: ${markdownText(exportProject.createdAt)}`,
    `Private mode: ${exportProject.privateMode ? "Yes — this project was not persisted by Opstalia" : "No"}`,
    "",
    "## Security boundary",
    "",
    "Opstalia is authorized only for unclassified, unrestricted metadata and public official-source records. It does not determine classification. The researcher is responsible for complying with handling restrictions. Opstalia 1.0 is an Internet application and is not connected to Opstalia-c or any closed network.",
    "",
    "## Search target",
    "",
    jsonCodeBlock(exportProject.target),
    "",
    "## Search terms used",
    "",
    queries || "- None",
    "",
    "## Automated sources searched",
    "",
    automatedRuns || "- None",
    "",
    "## Manual official-source handoffs",
    "",
    manualHandoffs || "- None",
    "",
    "## Sources unavailable",
    "",
    unavailableRuns || "- None",
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
    "- Complete prepared official manual-search handoffs and record any official locators found.",
    "- Retry unavailable official repositories after the source restores service.",
    "- Record the basis for any match, version, or release-status conclusion."
  ].join("\n");
}

function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  // Spreadsheet formulas can be hidden behind ASCII or Unicode control prefixes.
  // eslint-disable-next-line no-control-regex
  if (/^[\s\u0000-\u001f\u007f-\u009f]*[=+\-@]/u.test(text)) text = `'${text}`;
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
    "provenance_verification",
    "retrieved_or_recorded_at"
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
    record.provenance.importedUnverified
      ? "imported_source_not_revalidated"
      : record.provenance.normalizationVersion.includes("researcher-locator")
        ? "researcher_confirmed_locator"
        : "source_run",
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
