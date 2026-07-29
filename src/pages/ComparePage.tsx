import { useMemo, useState } from "react";
import type { NormalizedRecord, SearchProject, VersionGroup } from "../core/types";
import { diffWords } from "../analysis/text-diff";
import { compareVersions } from "../analysis/versioning";
import { makeId } from "../core/id";
import { EmptyState, ExternalLink, FieldProvenance, SectionHeading, SourceBadge, StatusStamp } from "../ui/common";
import { current, effectiveStatus, formatDate } from "../ui/format";

interface CompareProps {
  projects: SearchProject[];
  initialRecordIds: string[];
  onProjectUpdate: (project: SearchProject) => Promise<void> | void;
}

function allRecords(projects: SearchProject[]): Array<{ project: SearchProject; record: NormalizedRecord }> {
  return projects.flatMap((project) => project.records.map((record) => ({ project, record })));
}

export function ComparePage({ projects, initialRecordIds, onProjectUpdate }: CompareProps) {
  const available = useMemo(() => allRecords(projects), [projects]);
  const [leftId, setLeftId] = useState(initialRecordIds[0] ?? available[0]?.record.id ?? "");
  const [rightId, setRightId] = useState(initialRecordIds[1] ?? available.find((entry) => entry.record.id !== leftId)?.record.id ?? "");
  const [leftPage, setLeftPage] = useState(1);
  const [rightPage, setRightPage] = useState(1);
  const [syncPages, setSyncPages] = useState(true);
  const leftEntry = available.find((entry) => entry.record.id === leftId);
  const rightEntry = available.find((entry) => entry.record.id === rightId);
  const relationship = leftEntry && rightEntry ? compareVersions(leftEntry.record, rightEntry.record) : undefined;
  const diff = leftEntry && rightEntry
    ? diffWords(current(leftEntry.record.textSnippet) ?? "", current(rightEntry.record.textSnippet) ?? "")
    : [];

  const setPage = (side: "left" | "right", value: number) => {
    const page = Math.max(1, value || 1);
    if (side === "left") setLeftPage(page);
    else setRightPage(page);
    if (syncPages) {
      setLeftPage(page);
      setRightPage(page);
    }
  };

  const saveGroup = async (label: VersionGroup["relationships"][number]["label"]) => {
    if (!leftEntry || !rightEntry) return;
    const project = leftEntry.project;
    const existing = project.versionGroups.find((group) => group.recordIds.includes(leftId) && group.recordIds.includes(rightId));
    const group: VersionGroup = existing ?? {
      id: makeId("version-group"),
      label: current(leftEntry.record.title) ?? "Version group",
      recordIds: [leftId, rightId],
      relationships: [],
      reviewStatus: "awaiting_review"
    };
    const reviewed = {
      ...(relationship ?? compareVersions(leftEntry.record, rightEntry.record)),
      researcherOverride: {
        label,
        basis: "Researcher decision recorded in the comparison workspace",
        timestamp: new Date().toISOString()
      }
    };
    group.relationships = [reviewed];
    group.reviewStatus = label === "insufficient_evidence" ? "split" : "confirmed";
    const updated: SearchProject = {
      ...project,
      versionGroups: [...project.versionGroups.filter((item) => item.id !== group.id), group],
      updatedAt: new Date().toISOString()
    };
    await onProjectUpdate(updated);
  };

  return (
    <>
      <SectionHeading eyebrow="Human-review workspace" title="Compare public versions">
        <p>Side-by-side official copies, textual differences, page alignment, and an explainable relationship assessment. More text does not by itself establish authenticity or completeness.</p>
      </SectionHeading>
      {!available.length ? (
        <EmptyState title="No records available">
          <p>Run a search or install the demonstration projects before comparing versions.</p>
        </EmptyState>
      ) : (
        <>
          <div className="comparison-picker">
            <label>
              <span>Left version</span>
              <select value={leftId} onChange={(event) => setLeftId(event.target.value)}>
                {available.map(({ project, record }) => (
                  <option key={`${project.id}-${record.id}`} value={record.id}>{project.name} — {current(record.title)}</option>
                ))}
              </select>
            </label>
            <button
              className="swap-button"
              aria-label="Swap comparison sides"
              onClick={() => {
                setLeftId(rightId);
                setRightId(leftId);
              }}
            >
              ⇄
            </button>
            <label>
              <span>Right version</span>
              <select value={rightId} onChange={(event) => setRightId(event.target.value)}>
                {available.map(({ project, record }) => (
                  <option key={`${project.id}-${record.id}`} value={record.id}>{project.name} — {current(record.title)}</option>
                ))}
              </select>
            </label>
          </div>
          {leftEntry && rightEntry && (
            <>
              <section className="relationship-panel">
                <div>
                  <p className="eyebrow">Deterministic relationship assessment</p>
                  <h2>{relationship?.label.replaceAll("_", " ")}</h2>
                  <strong>{relationship?.score}/100 relationship score</strong>
                  <ul>{relationship?.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                  <FieldProvenance kind="inferred" />
                </div>
                <div className="review-buttons">
                  <p>Researcher decision</p>
                  <button onClick={() => void saveGroup("confirmed_same_document")}>Confirm same document</button>
                  <button onClick={() => void saveGroup("probable_version")}>Confirm probable version</button>
                  <button onClick={() => void saveGroup("possible_version")}>Keep as possible</button>
                  <button onClick={() => void saveGroup("insufficient_evidence")}>Split / reject relationship</button>
                </div>
              </section>
              <div className="comparison-timeline" aria-label="Release comparison timeline">
                {[leftEntry.record, rightEntry.record]
                  .sort((a, b) => String(current(a.releaseDate) ?? current(a.date) ?? "").localeCompare(String(current(b.releaseDate) ?? current(b.date) ?? "")))
                  .map((record) => (
                    <div key={record.id}>
                      <span aria-hidden="true" />
                      <strong>{formatDate(current(record.releaseDate) ?? current(record.date))}</strong>
                      <small>{current(record.sourceRepository)}</small>
                    </div>
                  ))}
              </div>
              <div className="compare-grid">
                {[leftEntry.record, rightEntry.record].map((record, index) => (
                  <article key={record.id} className="version-column">
                    <header>
                      <SourceBadge>{current(record.sourceRepository)}</SourceBadge>
                      <StatusStamp status={effectiveStatus(record)} />
                    </header>
                    <h2>{current(record.title)}</h2>
                    <ExternalLink href={current(record.officialUrl) ?? "#"}>Open official source</ExternalLink>
                    <dl className="record-facts">
                      <div><dt>Release date</dt><dd>{formatDate(current(record.releaseDate))}</dd></div>
                      <div><dt>Release mechanism</dt><dd>{current(record.releaseMechanism) ?? "Not reported"}</dd></div>
                      <div><dt>Release authority</dt><dd>{current(record.releaseAuthority) ?? "Not reported"}</dd></div>
                      <div><dt>Page count</dt><dd>{current(record.pageCount) ?? "Unknown"}</dd></div>
                      <div><dt>Legibility</dt><dd>Not automatically assessed</dd></div>
                      <div><dt>OCR</dt><dd>{current(record.ocrAvailability) ? "Available" : "Not reported"}</dd></div>
                      <div>
                        <dt>Redactions detected</dt>
                        <dd>
                          {record.classificationMarkings.filter((marking) => !marking.falsePositive).length ||
                            "None detected; not proof of absence"}
                        </dd>
                      </div>
                      <div>
                        <dt>Visible codes</dt>
                        <dd>
                          {record.exemptionCodes
                            .filter(
                              (code) =>
                                !record.classificationMarkings.some(
                                  (marking) => marking.code === code && marking.falsePositive
                                )
                            )
                            .join(", ") || "None reported"}
                        </dd>
                      </div>
                      <div><dt>Missing pages</dt><dd>Not determined</dd></div>
                      <div><dt>Attachments / files</dt><dd>{record.digitalObjects.length || "Not reported"}</dd></div>
                    </dl>
                    <div className="page-control">
                      <label>
                        Page alignment
                        <input
                          type="number"
                          min="1"
                          value={index === 0 ? leftPage : rightPage}
                          onChange={(event) => setPage(index === 0 ? "left" : "right", Number(event.target.value))}
                        />
                      </label>
                      {index === 0 && (
                        <label className="check-label">
                          <input type="checkbox" checked={syncPages} onChange={(event) => setSyncPages(event.target.checked)} />
                          Synchronize pages
                        </label>
                      )}
                    </div>
                    {current(record.downloadUrl) || record.digitalObjects[0]?.url ? (
                      <iframe
                        className="document-frame"
                        title={`${current(record.title)} official document viewer`}
                        src={`${current(record.downloadUrl) ?? record.digitalObjects[0].url}#page=${index === 0 ? leftPage : rightPage}`}
                        sandbox="allow-same-origin allow-downloads"
                      />
                    ) : (
                      <div className="viewer-placeholder">
                        <strong>No embeddable official file reported</strong>
                        <p>Use the official record link and record manual page alignment here.</p>
                      </div>
                    )}
                  </article>
                ))}
              </div>
              <section className="diff-panel">
                <header>
                  <div>
                    <p className="eyebrow">Available text / OCR</p>
                    <h2>Textual difference</h2>
                  </div>
                  <div className="diff-legend"><span className="removed">Removed</span><span className="added">Added</span></div>
                </header>
                {diff.length ? (
                  <p className="diff-text">
                    {diff.map((part, index) => <span key={`${part.type}-${index}`} className={`diff-${part.type}`}>{part.text} </span>)}
                  </p>
                ) : (
                  <p>No comparable OCR/text snippets are available. Use the synchronized page viewers for manual image comparison.</p>
                )}
              </section>
            </>
          )}
        </>
      )}
    </>
  );
}
