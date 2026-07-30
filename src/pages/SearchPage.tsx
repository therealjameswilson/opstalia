import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type {
  QueryKind,
  SearchPlan,
  SearchProject,
  SearchQuery,
  SearchTarget,
  SourceRun,
  SourceSearchResponse
} from "../core/types";
import { makeId } from "../core/id";
import { searchTargetSchema } from "../core/validation";
import { buildSearchPlan } from "../search/query-expansion";
import { runFederatedSearch } from "../search/client";
import { createManualOfficialRecord, type ManualOfficialRecordInput } from "../search/manual-record";
import { sourceRegistry } from "../data/registry";
import { deduplicateRecords, groupVersions } from "../analysis/versioning";
import { downloadText, projectToCsv, projectToJson, projectToMarkdown, projectToPrintableHtml } from "../reporting/exports";
import { copyText, safeFileName } from "../ui/format";
import { ExternalLink, SectionHeading } from "../ui/common";
import { ResultsPanel } from "./ResultsPanel";
import { ManualSourceActions } from "./ManualSourceActions";

const EMPTY_TARGET: SearchTarget = {
  mode: "guided",
  quickQuery: "",
  titleOrSubject: "",
  exactPhrase: "",
  generalKeywords: "",
  dateFrom: "",
  dateTo: "",
  originatingAgency: "",
  originatingOffice: "",
  authorSender: "",
  recipient: "",
  documentType: "",
  identifiers: "",
  geographicFocus: "",
  notes: ""
};
const OPTIONAL_NARA_PROFILE_IDS = new Set([
  "nara-cia-rg263",
  "nara-state-rg59"
]);

function upsertRun(runs: SourceRun[], next: SourceRun): SourceRun[] {
  return [...runs.filter((run) => run.sourceId !== next.sourceId), next].sort((left, right) => left.sourceId.localeCompare(right.sourceId));
}

function isResearcherLocator(record: SearchProject["records"][number]): boolean {
  return record.provenance.normalizationVersion.includes("researcher-locator");
}

function withManualRecordCount(
  run: SourceRun,
  records: SearchProject["records"]
): SourceRun {
  if (!run.manualHandoff) return run;
  const researcherResultCount = records.filter(
    (record) => record.provenance.sourceId === run.sourceId && isResearcherLocator(record)
  ).length;
  return {
    ...run,
    resultCount: researcherResultCount,
    manualHandoff: {
      ...run.manualHandoff,
      researcherResultCount
    }
  };
}

function searchName(target: SearchTarget): string {
  return target.titleOrSubject || target.quickQuery || target.identifiers || `Opstalia search ${new Date().toLocaleDateString()}`;
}

function targetsEqual(left: SearchTarget, right: SearchTarget): boolean {
  const keys: Array<keyof SearchTarget> = [
    "mode",
    "quickQuery",
    "titleOrSubject",
    "exactPhrase",
    "generalKeywords",
    "dateFrom",
    "dateTo",
    "originatingAgency",
    "originatingOffice",
    "authorSender",
    "recipient",
    "documentType",
    "identifiers",
    "geographicFocus",
    "notes"
  ];
  return keys.every((key) => left[key] === right[key]);
}

function shareTarget(target: SearchTarget): void {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(target)) {
    if (key === "notes" || !value) continue;
    parameters.set(key, String(value));
  }
  history.replaceState(null, "", `${location.pathname}${location.search}#search?${parameters}`);
}

function targetFromHash(): SearchTarget | undefined {
  if (!location.hash.startsWith("#search?")) return undefined;
  const parameters = new URLSearchParams(location.hash.slice("#search?".length));
  const target = { ...EMPTY_TARGET } as Record<string, string>;
  for (const key of Object.keys(EMPTY_TARGET)) {
    const value = parameters.get(key);
    if (value != null) target[key] = value;
  }
  target.mode = parameters.get("mode") === "quick" ? "quick" : "guided";
  return target as unknown as SearchTarget;
}

interface SearchPageProps {
  project?: SearchProject;
  onProjectUpdate: (project: SearchProject) => Promise<void> | void;
  onCompare: (recordIds: string[]) => void;
}

export function SearchPage({ project, onProjectUpdate, onCompare }: SearchPageProps) {
  const [target, setTarget] = useState<SearchTarget>(project?.target ?? targetFromHash() ?? EMPTY_TARGET);
  const [acknowledged, setAcknowledged] = useState(false);
  const [privateMode, setPrivateMode] = useState(project?.privateMode ?? false);
  const [plan, setPlan] = useState<SearchPlan | undefined>(project?.plan);
  const [selectedSources, setSelectedSources] = useState<string[]>(
    sourceRegistry.filter((source) => source.enabledByDefault).map((source) => source.id)
  );
  const [workspaceProject, setWorkspaceProject] = useState<SearchProject | undefined>(project);
  const [sourceRuns, setSourceRuns] = useState<SourceRun[]>(project?.sourceRuns ?? []);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [reportCopied, setReportCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (project) {
      setTarget(project.target);
      setPlan(project.plan);
      setPrivateMode(project.privateMode);
      setWorkspaceProject(project);
      setSourceRuns(project.sourceRuns);
      const projectSourceIds = [
        ...new Set(
          project.sourceRuns
            .map((run) => run.sourceId)
            .filter((sourceId) => sourceRegistry.some((source) => source.id === sourceId))
        )
      ];
      if (projectSourceIds.length) setSelectedSources(projectSourceIds);
    }
  }, [project?.id]);

  const selectedDefinitions = useMemo(
    () => sourceRegistry.filter((source) => selectedSources.includes(source.id)),
    [selectedSources]
  );

  const updateTarget = <K extends keyof SearchTarget>(key: K, value: SearchTarget[K]) => {
    setTarget((current) => ({ ...current, [key]: value }));
    if (plan) {
      setPlan(undefined);
      setMessage("Target metadata changed. Build and review a new search plan before running sources.");
    }
    setError("");
  };

  const updatePrivateMode = (enabled: boolean) => {
    if (workspaceProject) return;
    setPrivateMode(enabled);
    if (enabled && location.hash.startsWith("#search?")) {
      history.replaceState(null, "", `${location.pathname}${location.search}#new-search`);
    }
  };

  const buildPlan = (event?: FormEvent) => {
    event?.preventDefault();
    const validation = searchTargetSchema.safeParse(target);
    if (!validation.success) {
      setError(validation.error.issues.map((issue) => issue.message).join(" "));
      return;
    }
    if (!acknowledged) {
      setError("Acknowledge the unclassified-use notice before building or running a search.");
      return;
    }
    const automatedSourceIds = sourceRegistry
      .filter(
        (source) =>
          selectedSources.includes(source.id) &&
          source.searchCapability === "automated"
      )
      .map((source) => source.id);
    const generated = buildSearchPlan(validation.data);
    const next = {
      ...generated,
      queries: generated.queries.map((query) => ({
        ...query,
        sourceIds: automatedSourceIds
      }))
    };
    setPlan(next);
    setMessage(`${next.queries.length} deterministic query variants generated. Review and edit them before search.`);
    if (!privateMode) shareTarget(validation.data);
  };

  const updateQuery = (queryId: string, update: Partial<SearchQuery>) => {
    setPlan((current) =>
      current ? { ...current, queries: current.queries.map((query) => (query.id === queryId ? { ...query, ...update } : query)) } : current
    );
  };

  const toggleSourceSelection = (sourceId: string, checked: boolean) => {
    setSelectedSources((current) =>
      checked
        ? [...new Set([...current, sourceId])]
        : current.filter((id) => id !== sourceId)
    );
    const source = sourceRegistry.find((entry) => entry.id === sourceId);
    if (source?.searchCapability !== "automated") return;
    setPlan((current) =>
      current
        ? {
            ...current,
            queries: current.queries.map((query) => ({
              ...query,
              sourceIds: checked
                ? [...new Set([...query.sourceIds, sourceId])]
                : query.sourceIds.filter((id) => id !== sourceId)
            }))
          }
        : current
    );
  };

  const runSearch = async () => {
    if (!plan || !acknowledged || !selectedDefinitions.length) {
      setError("Build a search plan, acknowledge the notice, and select at least one official source.");
      return;
    }
    if (!plan.queries.some((query) => query.enabled && query.text.trim())) {
      setError("Enable at least one non-empty query.");
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setError("");
    setMessage("Running automated official-source adapters and preparing manual search handoffs. Source failures will remain isolated.");
    const existingProject = workspaceProject ?? project;
    const continuingProject =
      existingProject && !existingProject.fixture && targetsEqual(existingProject.target, plan.target)
        ? existingProject
        : undefined;
    const existingSavedIds = new Set(continuingProject?.savedRecordIds ?? []);
    const preservedRecords =
      continuingProject?.records.filter(
            (record) => existingSavedIds.has(record.id) || isResearcherLocator(record)
          ) ?? [];
    let partialRecords: SearchProject["records"] = preservedRecords;
    let partialRaw: SearchProject["rawRecords"] = [];
    let partialRuns: SourceRun[] = [];
    const now = new Date().toISOString();
    const base: SearchProject = {
      id: continuingProject?.id ?? makeId("project"),
      name: searchName(plan.target),
      createdAt: continuingProject?.createdAt ?? now,
      updatedAt: now,
      target: plan.target,
      plan,
      sourceRuns: [],
      rawRecords: [],
      records: preservedRecords,
      savedRecordIds: preservedRecords
        .filter((record) => existingSavedIds.has(record.id))
        .map((record) => record.id),
      versionGroups: [],
      comparisons: [],
      notes: continuingProject?.notes ?? [],
      auditEvents: [
        ...(continuingProject?.auditEvents ?? []),
        {
          id: makeId("audit"),
          timestamp: now,
          action: "Started federated official-source search",
          basis: `${plan.queries.filter((query) => query.enabled).length} enabled plan queries; ${selectedDefinitions.length} sources`,
          actor: "opstalia"
        }
      ],
      privateMode
    };
    setWorkspaceProject(base);
    setSourceRuns([]);
    try {
      const result = await runFederatedSearch(
        plan,
        selectedDefinitions,
        privateMode,
        (run) => {
          partialRuns = upsertRun(partialRuns, withManualRecordCount(run, partialRecords));
          setSourceRuns(partialRuns);
        },
        (response: SourceSearchResponse) => {
          partialRecords = deduplicateRecords([...partialRecords, ...response.records]);
          partialRaw = [...partialRaw, ...response.rawRecords];
          partialRuns = partialRuns.map((run) => withManualRecordCount(run, partialRecords));
          const partial: SearchProject = {
            ...base,
            sourceRuns: partialRuns,
            records: [...partialRecords].sort((left, right) => right.confidenceScore - left.confidenceScore),
            rawRecords: partialRaw,
            versionGroups: groupVersions(partialRecords),
            updatedAt: new Date().toISOString()
          };
          setWorkspaceProject(partial);
        },
        controller.signal
      );
      const completeRecords = deduplicateRecords([...preservedRecords, ...result.records]);
      const completeRecordIds = new Set(completeRecords.map((record) => record.id));
      const completeRuns = result.sourceRuns.map((run) => withManualRecordCount(run, completeRecords));
      const wasCancelled = controller.signal.aborted;
      const complete: SearchProject = {
        ...base,
        sourceRuns: completeRuns,
        records: completeRecords,
        rawRecords: result.rawRecords,
        savedRecordIds: base.savedRecordIds.filter((recordId) => completeRecordIds.has(recordId)),
        versionGroups: groupVersions(completeRecords),
        comparisons:
          (continuingProject?.comparisons ?? []).filter((comparison) =>
            comparison.recordIds.every((recordId) => completeRecordIds.has(recordId))
          ),
        updatedAt: new Date().toISOString(),
        auditEvents: [
          ...base.auditEvents,
          {
            id: makeId("audit"),
            timestamp: new Date().toISOString(),
            action: wasCancelled
              ? "Cancelled federated official-source search"
              : "Completed federated official-source search",
            basis: `${completeRecords.length} normalized official results retained; ${result.warnings.length} source warnings`,
            actor: "opstalia"
          }
        ]
      };
      setWorkspaceProject(complete);
      setSourceRuns(completeRuns);
      await onProjectUpdate(complete);
      setMessage(
        `${wasCancelled ? "Search cancelled; partial work retained" : "Search complete"} with ${completeRecords.length} normalized result${completeRecords.length === 1 ? "" : "s"}. ${
          privateMode ? "Private mode kept this project in memory only." : "The project was saved locally."
        }`
      );
    } catch (searchError) {
      if (controller.signal.aborted) setMessage("Search cancelled. Completed source results remain visible.");
      else setError(searchError instanceof Error ? searchError.message : "Search failed.");
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const commitWorkspace = async (next: SearchProject) => {
    setWorkspaceProject(next);
    await onProjectUpdate(next);
  };

  const markManualHandoffOpened = (sourceId: string) => {
    const timestamp = new Date().toISOString();
    const currentRun = sourceRuns.find((run) => run.sourceId === sourceId);
    if (!currentRun?.manualHandoff || currentRun.manualHandoff.openedAt) return;
    const nextRuns = sourceRuns.map((run) =>
      run.sourceId === sourceId && run.manualHandoff
        ? {
            ...run,
            manualHandoff: {
              ...run.manualHandoff,
              status:
                run.manualHandoff.status === "prepared"
                  ? "opened" as const
                  : run.manualHandoff.status,
              openedAt: timestamp
            }
          }
        : run
    );
    setSourceRuns(nextRuns);
    if (workspaceProject) {
      void commitWorkspace({
        ...workspaceProject,
        sourceRuns: nextRuns,
        updatedAt: timestamp,
        auditEvents: [
          ...workspaceProject.auditEvents,
          {
            id: makeId("audit"),
            timestamp,
            action: "Opened official manual-search handoff",
            subjectId: sourceId,
            basis: "Researcher initiated navigation; Opstalia did not retrieve the destination results.",
            actor: "researcher"
          }
        ]
      });
    }
  };

  const addManualOfficialRecord = async (
    sourceId: string,
    input: ManualOfficialRecordInput
  ) => {
    if (!workspaceProject) throw new Error("Run or prepare the source before recording a result.");
    const source = sourceRegistry.find((entry) => entry.id === sourceId);
    if (!source) throw new Error("The source is not registered.");
    const record = createManualOfficialRecord(source, workspaceProject.target, input);
    if (
      workspaceProject.records.some(
        (existing) =>
          existing.provenance.sourceId === sourceId &&
          existing.officialUrl.value === record.officialUrl.value
      )
    ) {
      throw new Error("That official locator is already in this project.");
    }
    const timestamp = new Date().toISOString();
    const records = [...workspaceProject.records, record];
    const sourceRecordCount = records.filter((item) => item.provenance.sourceId === sourceId).length;
    const nextRuns = sourceRuns.map((run) =>
      run.sourceId === sourceId && run.manualHandoff
        ? {
            ...run,
            resultCount: sourceRecordCount,
            manualHandoff: {
              ...run.manualHandoff,
              researcherResultCount: sourceRecordCount
            }
          }
        : run
    );
    const next: SearchProject = {
      ...workspaceProject,
      sourceRuns: nextRuns,
      records,
      savedRecordIds: [...new Set([...workspaceProject.savedRecordIds, record.id])],
      versionGroups: groupVersions(records),
      updatedAt: timestamp,
      auditEvents: [
        ...workspaceProject.auditEvents,
        {
          id: makeId("audit"),
          timestamp,
          action: "Recorded researcher-confirmed official locator",
          subjectId: record.id,
          basis: `${source.displayName}; approved official domain; document contents were not fetched.`,
          actor: "researcher"
        }
      ]
    };
    setSourceRuns(nextRuns);
    await commitWorkspace(next);
    setMessage(`Added one official ${source.displayName} locator to this project and Saved Records.`);
  };

  const exportBase = safeFileName(workspaceProject?.name ?? "opstalia-report");

  return (
    <>
      <SectionHeading eyebrow="New research project" title="Define the target record">
        <p>Supply only unclassified identifying information. Opstalia turns it into an editable, deterministic search plan.</p>
      </SectionHeading>
      <section className="notice notice-danger security-acknowledgement" aria-labelledby="security-notice-title">
        <div className="security-icon" aria-hidden="true">!</div>
        <div>
          <h2 id="security-notice-title">Use unclassified information only.</h2>
          <p>Do not enter, upload, paste, or transmit classified information, controlled unclassified information, personally identifiable information, or other restricted material. Opstalia searches public U.S. Government repositories and is not an authorized system for classified records.</p>
          <label className="acknowledge">
            <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
            <span>I acknowledge this notice and will use only unclassified, unrestricted search information.</span>
          </label>
        </div>
      </section>

      <form className="search-builder" onSubmit={buildPlan}>
        <div className="mode-tabs" role="tablist" aria-label="Search mode">
          <button type="button" role="tab" aria-selected={target.mode === "guided"} className={target.mode === "guided" ? "active" : ""} onClick={() => updateTarget("mode", "guided")}>Guided search</button>
          <button type="button" role="tab" aria-selected={target.mode === "quick"} className={target.mode === "quick" ? "active" : ""} onClick={() => updateTarget("mode", "quick")}>Quick search</button>
        </div>
        {target.mode === "quick" ? (
          <div className="quick-fields">
            <label className="wide-field">
              <span>Unclassified metadata and keywords</span>
              <input value={target.quickQuery ?? ""} onChange={(event) => updateTarget("quickQuery", event.target.value)} maxLength={500} placeholder="Memorandum from Scowcroft to Bush, Malta, December 1989" />
            </label>
            <label><span>Date from</span><input type="date" value={target.dateFrom ?? ""} onChange={(event) => updateTarget("dateFrom", event.target.value)} /></label>
            <label><span>Date to</span><input type="date" value={target.dateTo ?? ""} onChange={(event) => updateTarget("dateTo", event.target.value)} /></label>
            <label><span>Agency filter</span><input value={target.originatingAgency ?? ""} onChange={(event) => updateTarget("originatingAgency", event.target.value)} maxLength={200} /></label>
          </div>
        ) : (
          <div className="guided-fields">
            <label className="wide-field"><span>Title or subject</span><input value={target.titleOrSubject ?? ""} onChange={(event) => updateTarget("titleOrSubject", event.target.value)} maxLength={500} /></label>
            <label className="wide-field"><span>Exact phrase</span><input value={target.exactPhrase ?? ""} onChange={(event) => updateTarget("exactPhrase", event.target.value)} maxLength={500} placeholder="Do not include quotation marks" /></label>
            <label className="wide-field"><span>General keywords</span><input value={target.generalKeywords ?? ""} onChange={(event) => updateTarget("generalKeywords", event.target.value)} maxLength={500} /></label>
            <label><span>Date from</span><input type="date" value={target.dateFrom ?? ""} onChange={(event) => updateTarget("dateFrom", event.target.value)} /></label>
            <label><span>Date to</span><input type="date" value={target.dateTo ?? ""} onChange={(event) => updateTarget("dateTo", event.target.value)} /></label>
            <label><span>Originating agency</span><input value={target.originatingAgency ?? ""} onChange={(event) => updateTarget("originatingAgency", event.target.value)} maxLength={200} /></label>
            <label><span>Originating office</span><input value={target.originatingOffice ?? ""} onChange={(event) => updateTarget("originatingOffice", event.target.value)} maxLength={200} /></label>
            <label><span>Author or sender</span><input value={target.authorSender ?? ""} onChange={(event) => updateTarget("authorSender", event.target.value)} maxLength={300} /></label>
            <label><span>Recipient</span><input value={target.recipient ?? ""} onChange={(event) => updateTarget("recipient", event.target.value)} maxLength={300} /></label>
            <label><span>Document type</span><input value={target.documentType ?? ""} onChange={(event) => updateTarget("documentType", event.target.value)} maxLength={200} placeholder="memorandum, cable, report…" /></label>
            <label><span>Identifiers</span><input value={target.identifiers ?? ""} onChange={(event) => updateTarget("identifiers", event.target.value)} maxLength={500} placeholder="NAID, RG 59, collection ID, ancestor NAID, case or document number" /></label>
            <label><span>Geographic focus</span><input value={target.geographicFocus ?? ""} onChange={(event) => updateTarget("geographicFocus", event.target.value)} maxLength={300} /></label>
            <label className="wide-field"><span>Notes for this search <small>(local only; not sent as a query)</small></span><textarea value={target.notes ?? ""} onChange={(event) => updateTarget("notes", event.target.value)} maxLength={2000} /></label>
          </div>
        )}
        <div className="privacy-row">
          <label className="private-toggle">
            <input
              type="checkbox"
              checked={privateMode}
              disabled={Boolean(workspaceProject)}
              onChange={(event) => updatePrivateMode(event.target.checked)}
            />
            <span>
              <strong>Private search mode</strong>
              <small>
                Memory-only project; no Opstalia search history or live NARA response cache. Static public index assets may be cached. Queries still reach selected live official sources.
                {workspaceProject ? " Start a new project to change this setting." : ""}
              </small>
            </span>
          </label>
          <button className="button button-primary" type="submit" disabled={!acknowledged}>Build search plan</button>
        </div>
      </form>
      {error && <div className="error-message" role="alert">{error}</div>}
      {message && <div className="status-message" role="status">{message}</div>}

      {plan && (
        <section className="search-plan" aria-labelledby="plan-title">
          <header>
            <div>
              <p className="eyebrow">Step 2 · deterministic expansion</p>
              <h2 id="plan-title">Editable search plan</h2>
              <p>No paid AI API generated these terms.</p>
            </div>
            <div className="plan-actions">
              {!privateMode && <button className="text-button" onClick={() => { shareTarget(target); void copyText(location.href).then(() => setMessage("Shareable unclassified search link copied.")); }}>Copy search link</button>}
              <button
                className="text-button"
                onClick={() =>
                  setPlan((current) =>
                    current
                      ? {
                          ...current,
                          queries: [
                            ...current.queries,
                            {
                              id: makeId("query"),
                              label: "Researcher-added query",
                              text: "",
                              kind: "broad_keyword" as QueryKind,
                              enabled: true,
                              sourceIds: sourceRegistry
                                .filter(
                                  (source) =>
                                    selectedSources.includes(source.id) &&
                                    source.searchCapability === "automated"
                                )
                                .map((source) => source.id),
                              explanation: "Researcher-added search variant"
                            }
                          ]
                        }
                      : current
                  )
                }
              >
                + Add query
              </button>
            </div>
          </header>
          <ol className="query-list">
            {plan.queries.map((query, index) => (
              <li key={query.id}>
                <label className="query-enabled">
                  <input type="checkbox" checked={query.enabled} onChange={(event) => updateQuery(query.id, { enabled: event.target.checked })} />
                  <span className="sr-only">Enable query {index + 1}</span>
                </label>
                <div>
                  <span className="query-kind">{query.kind.replaceAll("_", " ")}</span>
                  <input aria-label={`Query ${index + 1} text`} value={query.text} onChange={(event) => updateQuery(query.id, { text: event.target.value })} maxLength={500} />
                  <small>{query.explanation}</small>
                </div>
                <button className="remove-query" aria-label={`Remove query ${index + 1}`} onClick={() => setPlan((current) => current ? { ...current, queries: current.queries.filter((item) => item.id !== query.id) } : current)}>×</button>
              </li>
            ))}
          </ol>
          <div className="strategy-grid">
            <div>
              <h3>Source-selection strategy</h3>
              {plan.sourceSelectionStrategy.map((strategy, index) => (
                <label key={`${index}-${strategy.slice(0, 20)}`}>
                  <span className="sr-only">Strategy {index + 1}</span>
                  <textarea
                    value={strategy}
                    onChange={(event) =>
                      setPlan((current) =>
                        current
                          ? {
                              ...current,
                              sourceSelectionStrategy: current.sourceSelectionStrategy.map((item, itemIndex) =>
                                itemIndex === index ? event.target.value : item
                              )
                            }
                          : current
                      )
                    }
                    maxLength={500}
                  />
                </label>
              ))}
            </div>
            <fieldset className="source-selector">
              <legend>Sources and handoffs for this run</legend>
              {[
                {
                  label: "Automated adapters",
                  sources: sourceRegistry.filter((source) => source.enabledByDefault && source.searchCapability === "automated")
                },
                {
                  label: "Optional NARA Catalog discovery profiles",
                  sources: sourceRegistry.filter((source) =>
                    OPTIONAL_NARA_PROFILE_IDS.has(source.id)
                  )
                },
                {
                  label: "Manual searches to prepare",
                  sources: sourceRegistry.filter(
                    (source) =>
                      source.enabledByDefault &&
                      source.searchCapability === "manual" &&
                      source.adapterStatus !== "temporarily_unavailable"
                  )
                },
                {
                  label: "Unavailable sources · prepare retry terms",
                  sources: sourceRegistry.filter(
                    (source) => source.enabledByDefault && source.adapterStatus === "temporarily_unavailable"
                  )
                }
              ].map((group) => (
                group.sources.length > 0 && (
                  <div className="source-option-group" key={group.label}>
                    <p>{group.label}</p>
                    {group.sources.map((source) => (
                      <label key={source.id}>
                        <input
                          type="checkbox"
                          checked={selectedSources.includes(source.id)}
                          onChange={(event) =>
                            toggleSourceSelection(source.id, event.target.checked)
                          }
                        />
                        <span>
                          <strong>{source.displayName}</strong>
                          <small>
                            {source.adapterStatus === "temporarily_unavailable"
                              ? "terms only · upstream unavailable"
                              : `${source.searchCapability} · ${source.adapterStatus.replaceAll("_", " ")}`}
                          </small>
                        </span>
                      </label>
                    ))}
                  </div>
                )
              ))}
              <details>
                <summary>Add another registered official source</summary>
                {sourceRegistry
                  .filter(
                    (source) =>
                      !source.enabledByDefault &&
                      source.searchCapability !== "planned" &&
                      !OPTIONAL_NARA_PROFILE_IDS.has(source.id)
                  )
                  .map((source) => (
                  <label key={source.id}>
                    <input
                      type="checkbox"
                      checked={selectedSources.includes(source.id)}
                      onChange={(event) =>
                        toggleSourceSelection(source.id, event.target.checked)
                      }
                    />
                    <span><strong>{source.displayName}</strong><small>{source.searchCapability} · {source.adapterStatus.replaceAll("_", " ")}</small></span>
                  </label>
                ))}
                <p className="fine-print">
                  Planned registry entries appear on Source Coverage and cannot be selected until an adapter or
                  official manual-search handoff is implemented.
                </p>
              </details>
            </fieldset>
          </div>
          <div className="run-row">
            <p>
              Each Worker-backed source is capped at the first three applicable plan queries.
              The NARA Catalog profiles share the NARA API quota and search NARA holdings only;
              they do not search the native CIA or State FOIA reading rooms. Manual sources
              receive a prepared handoff only, and nothing opens automatically.
            </p>
            {running ? (
              <button className="button button-danger" onClick={() => abortRef.current?.abort()}>Stop search</button>
            ) : (
              <button className="button button-primary" onClick={() => void runSearch()}>Run adapters and prepare handoffs</button>
            )}
          </div>
        </section>
      )}

      {sourceRuns.length > 0 && (
        <section className="source-progress" aria-labelledby="progress-title" aria-live="polite">
          <header><p className="eyebrow">Step 3 · isolated source execution</p><h2 id="progress-title">Source progress</h2></header>
          <ul>
            {sourceRuns.map((run) => {
              const source = sourceRegistry.find((entry) => entry.id === run.sourceId);
              return (
                <li key={run.sourceId}>
                  <span className={`progress-icon progress-${run.status}`} aria-hidden="true" />
                  <div>
                    <strong>{source?.displayName ?? run.sourceId}</strong>
                    <small>{run.message ?? run.status.replaceAll("_", " ")}</small>
                    {source && run.manualHandoff && (
                      <ManualSourceActions
                        run={run}
                        source={source}
                        enabled={acknowledged && !running}
                        onOpen={() => markManualHandoffOpened(run.sourceId)}
                        onRecord={(input) => addManualOfficialRecord(run.sourceId, input)}
                      />
                    )}
                    {!run.manualHandoff && run.manualSearchUrl && acknowledged && !running && (
                      <ExternalLink href={run.manualSearchUrl}>Open official source</ExternalLink>
                    )}
                    {!run.manualHandoff && run.manualSearchUrl && (!acknowledged || running) && (
                      <button type="button" className="button button-secondary" disabled>
                        Open official source
                      </button>
                    )}
                  </div>
                  <span>
                    {run.manualHandoff
                      ? run.resultCount
                        ? `${run.resultCount} recorded`
                        : "Handoff only"
                      : `${run.resultCount} results`}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {workspaceProject && (sourceRuns.length > 0 || workspaceProject.records.length > 0) && !running && (
        <div className="report-toolbar">
          <strong>Research report</strong>
          <button onClick={() => downloadText(`${exportBase}.md`, projectToMarkdown(workspaceProject), "text/markdown")}>Markdown</button>
          <button onClick={() => downloadText(`${exportBase}.csv`, projectToCsv(workspaceProject), "text/csv")}>CSV</button>
          <button onClick={() => downloadText(`${exportBase}.json`, projectToJson(workspaceProject), "application/json")}>JSON project</button>
          <button onClick={() => downloadText(`${exportBase}.print.html`, projectToPrintableHtml(workspaceProject), "text/html")}>Printable HTML / PDF</button>
          <button
            onClick={() => void copyText(projectToMarkdown(workspaceProject)).then(() => {
              setReportCopied(true);
              setTimeout(() => setReportCopied(false), 2000);
            })}
          >
            {reportCopied ? "Copied" : "Copy report"}
          </button>
        </div>
      )}

      {workspaceProject && workspaceProject.records.length > 0 && (
        <>
          <ResultsPanel
            project={workspaceProject}
            onUpdate={(next) => void commitWorkspace(next)}
            onCompare={(recordId) => onCompare([recordId])}
          />
        </>
      )}
    </>
  );
}
