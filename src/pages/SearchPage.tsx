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
import { sourceRegistry } from "../data/registry";
import { deduplicateRecords, groupVersions } from "../analysis/versioning";
import { downloadText, projectToCsv, projectToJson, projectToMarkdown, projectToPrintableHtml } from "../reporting/exports";
import { copyText, safeFileName } from "../ui/format";
import { ExternalLink, SectionHeading } from "../ui/common";
import { ResultsPanel } from "./ResultsPanel";

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

function upsertRun(runs: SourceRun[], next: SourceRun): SourceRun[] {
  return [...runs.filter((run) => run.sourceId !== next.sourceId), next].sort((left, right) => left.sourceId.localeCompare(right.sourceId));
}

function searchName(target: SearchTarget): string {
  return target.titleOrSubject || target.quickQuery || target.identifiers || `Opstalia search ${new Date().toLocaleDateString()}`;
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
    }
  }, [project?.id]);

  const selectedDefinitions = useMemo(
    () => sourceRegistry.filter((source) => selectedSources.includes(source.id)),
    [selectedSources]
  );

  const updateTarget = <K extends keyof SearchTarget>(key: K, value: SearchTarget[K]) => {
    setTarget((current) => ({ ...current, [key]: value }));
    setError("");
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
    const next = buildSearchPlan(validation.data);
    setPlan(next);
    setMessage(`${next.queries.length} deterministic query variants generated. Review and edit them before search.`);
    if (!privateMode) shareTarget(validation.data);
  };

  const updateQuery = (queryId: string, update: Partial<SearchQuery>) => {
    setPlan((current) =>
      current ? { ...current, queries: current.queries.map((query) => (query.id === queryId ? { ...query, ...update } : query)) } : current
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
    setMessage("Searching supported official repositories. Source failures will remain isolated.");
    let partialRecords: SearchProject["records"] = [];
    let partialRaw: SearchProject["rawRecords"] = [];
    let partialRuns: SourceRun[] = [];
    const now = new Date().toISOString();
    const base: SearchProject = {
      id: project?.id && !project.fixture ? project.id : makeId("project"),
      name: searchName(plan.target),
      createdAt: project?.createdAt && !project.fixture ? project.createdAt : now,
      updatedAt: now,
      target: plan.target,
      plan,
      sourceRuns: [],
      rawRecords: [],
      records: [],
      savedRecordIds: project?.fixture ? [] : project?.savedRecordIds ?? [],
      versionGroups: [],
      comparisons: project?.fixture ? [] : project?.comparisons ?? [],
      notes: project?.fixture ? [] : project?.notes ?? [],
      auditEvents: [
        ...(project?.fixture ? [] : project?.auditEvents ?? []),
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
          partialRuns = upsertRun(partialRuns, run);
          setSourceRuns(partialRuns);
        },
        (response: SourceSearchResponse) => {
          partialRecords = deduplicateRecords([...partialRecords, ...response.records]);
          partialRaw = [...partialRaw, ...response.rawRecords];
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
      const complete: SearchProject = {
        ...base,
        sourceRuns: result.sourceRuns,
        records: result.records,
        rawRecords: result.rawRecords,
        versionGroups: groupVersions(result.records),
        updatedAt: new Date().toISOString(),
        auditEvents: [
          ...base.auditEvents,
          {
            id: makeId("audit"),
            timestamp: new Date().toISOString(),
            action: "Completed federated official-source search",
            basis: `${result.records.length} normalized official results; ${result.warnings.length} source warnings`,
            actor: "opstalia"
          }
        ]
      };
      setWorkspaceProject(complete);
      setSourceRuns(result.sourceRuns);
      await onProjectUpdate(complete);
      setMessage(
        `Search complete with ${result.records.length} normalized result${result.records.length === 1 ? "" : "s"}. ${
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
            <input type="checkbox" checked={privateMode} onChange={(event) => setPrivateMode(event.target.checked)} />
            <span><strong>Private search mode</strong><small>Memory-only project; no Opstalia search history or live NARA response cache. Static public index assets may be cached. Queries still reach selected live official sources.</small></span>
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
                              sourceIds: ["nara", "frus", "iscap", "ndc"],
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
              <legend>Sources for this run</legend>
              {sourceRegistry.filter((source) => source.enabledByDefault).map((source) => (
                <label key={source.id}>
                  <input
                    type="checkbox"
                    checked={selectedSources.includes(source.id)}
                    onChange={(event) =>
                      setSelectedSources((current) =>
                        event.target.checked ? [...current, source.id] : current.filter((id) => id !== source.id)
                      )
                    }
                  />
                  <span>
                    <strong>{source.displayName}</strong>
                    <small>{source.searchCapability} · {source.adapterStatus.replaceAll("_", " ")}</small>
                  </span>
                </label>
              ))}
              <details>
                <summary>Add another registered official source</summary>
                {sourceRegistry.filter((source) => !source.enabledByDefault).map((source) => (
                  <label key={source.id}>
                    <input
                      type="checkbox"
                      checked={selectedSources.includes(source.id)}
                      onChange={(event) =>
                        setSelectedSources((current) =>
                          event.target.checked ? [...current, source.id] : current.filter((id) => id !== source.id)
                        )
                      }
                    />
                    <span><strong>{source.displayName}</strong><small>{source.searchCapability} · {source.adapterStatus.replaceAll("_", " ")}</small></span>
                  </label>
                ))}
              </details>
            </fieldset>
          </div>
          <div className="run-row">
            <p>NARA is capped at the first three enabled plan queries per run to protect the monthly quota. Local indexes may evaluate every enabled variant.</p>
            {running ? (
              <button className="button button-danger" onClick={() => abortRef.current?.abort()}>Stop search</button>
            ) : (
              <button className="button button-primary" onClick={() => void runSearch()}>Search selected official sources</button>
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
                  <div><strong>{source?.displayName ?? run.sourceId}</strong><small>{run.message ?? run.status.replaceAll("_", " ")}</small></div>
                  <span>{run.resultCount} results</span>
                  {run.manualSearchUrl && <ExternalLink href={run.manualSearchUrl}>Manual search</ExternalLink>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {workspaceProject && workspaceProject.records.length > 0 && (
        <>
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
