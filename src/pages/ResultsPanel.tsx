import { useMemo, useState } from "react";
import type { NormalizedRecord, ReleaseStatus, SearchProject } from "../core/types";
import { exemptionCodes } from "../data/registry";
import { Confidence, ExternalLink, FieldProvenance, SourceBadge, StatusStamp } from "../ui/common";
import { current, effectiveStatus, formatDate } from "../ui/format";

interface ResultsProps {
  project: SearchProject;
  onUpdate: (project: SearchProject) => void;
  onCompare: (recordId: string) => void;
}

function distinct(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}

function updateRecord(project: SearchProject, recordId: string, update: (record: NormalizedRecord) => NormalizedRecord): SearchProject {
  return {
    ...project,
    records: project.records.map((record) => (record.id === recordId ? update(record) : record)),
    updatedAt: new Date().toISOString()
  };
}

function RecordCard({
  record,
  saved,
  groupLabel,
  compact,
  onSave,
  onUpdate,
  onCompare
}: {
  record: NormalizedRecord;
  saved: boolean;
  groupLabel?: string;
  compact: boolean;
  onSave: () => void;
  onUpdate: (record: NormalizedRecord) => void;
  onCompare: () => void;
}) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const [basis, setBasis] = useState(record.review.basis ?? "");
  const [notes, setNotes] = useState(record.review.notes ?? "");
  const [correctedTitle, setCorrectedTitle] = useState(current(record.title) ?? "");
  const [reviewError, setReviewError] = useState("");
  const sourceStatus = record.review.releaseStatusOverride?.status ?? record.releaseStatus.status;
  const activeExemptionCodes = record.exemptionCodes.filter(
    (code) => !record.classificationMarkings.some((marking) => marking.code === code && marking.falsePositive)
  );
  const genericMarkings = record.classificationMarkings.filter(
    (marking) => !marking.falsePositive && !marking.code
  );
  const setReleaseStatus = (status: ReleaseStatus) => {
    if (status === "released_in_full" && !basis.trim()) {
      setReviewError("Record a judgment basis before designating a record released in full.");
      return;
    }
    setReviewError("");
    onUpdate({
      ...record,
      review: {
        ...record.review,
        releaseStatusOverride: {
          status,
          determinationBasis: basis || "Researcher override; basis not yet recorded",
          source: "researcher",
          confidence: 1,
          humanReview: true
        },
        updatedAt: new Date().toISOString()
      }
    });
  };
  return (
    <article className={`record-card ${compact ? "record-compact" : ""}`}>
      <header className="record-card-header">
        <div>
          <SourceBadge>{current(record.sourceRepository)}</SourceBadge>
          {record.provenance.fixture && <span className="fixture-badge">Fixture</span>}
          {record.provenance.importedUnverified && (
            <span
              className="fixture-badge"
              title="This project passed structural and official-domain checks, but its source provenance was not revalidated live."
            >
              Imported · source not revalidated
            </span>
          )}
          {groupLabel && <span className="version-badge">Version group: {groupLabel}</span>}
        </div>
        <div className="record-status">
          <StatusStamp status={effectiveStatus(record)} />
          <Confidence score={record.confidenceScore} />
        </div>
      </header>
      <h2>{current(record.title)}</h2>
      <div className="record-meta">
        <span>{formatDate(current(record.date))}</span>
        {current(record.originatingAgency) && <span>{current(record.originatingAgency)}</span>}
        {current(record.documentType) && <span>{current(record.documentType)}</span>}
        {current(record.naraNaid) && <span>NAID {current(record.naraNaid)}</span>}
        {current(record.documentNumber) && <span>Document {current(record.documentNumber)}</span>}
        {current(record.caseNumber) && <span>{current(record.caseNumber)}</span>}
      </div>
      {!compact && current(record.textSnippet) && <p className="record-snippet">{current(record.textSnippet)}</p>}
      <div className="record-flags">
        <FieldProvenance
          kind={
            record.title.researcherOverride || record.title.extractionMethod === "researcher_corrected"
              ? "corrected"
              : record.title.extractionMethod === "researcher_confirmed"
                ? "researcher"
                : record.title.extractionMethod === "ocr" || record.title.extractionMethod === "pattern_match"
                  ? "extracted"
                  : record.title.extractionMethod === "algorithmic_inference"
                    ? "inferred"
                    : "source"
          }
        />
        {record.matchExplanation.length > 0 && <FieldProvenance kind="inferred" />}
        {record.review.disposition !== "unreviewed" && <FieldProvenance kind="researcher" />}
        {activeExemptionCodes.map((code) => {
          const definition = exemptionCodes.find((entry) => entry.code === code);
          return <span key={code} className="code-chip" title={definition?.shortDefinition ?? "Unrecognized or ambiguous release marking"}>{code}</span>;
        })}
        {genericMarkings.map((marking) => (
          <span key={marking.id} className="code-chip" title={marking.system ?? "Unrecognized or ambiguous release marking"}>
            {marking.text}
          </span>
        ))}
      </div>
      <div className="record-actions">
        <ExternalLink href={current(record.officialUrl) ?? "#"} className="button button-primary">Official record</ExternalLink>
        <button className="button button-secondary" onClick={onSave}>{saved ? "★ Saved" : "☆ Save record"}</button>
        <button className="button button-secondary" onClick={onCompare}>Compare</button>
        <button className="text-button" onClick={() => setReviewOpen((value) => !value)} aria-expanded={reviewOpen}>Researcher review</button>
      </div>
      <details className="match-details">
        <summary>Why this matched · {record.confidenceScore}/100</summary>
        <ul>
          {record.matchExplanation.length ? record.matchExplanation.map((factor) => (
            <li key={`${factor.label}-${factor.detail}`}>
              <strong className={factor.points < 0 ? "negative-points" : ""}>{factor.points >= 0 ? "+" : ""}{factor.points}</strong>
              <span>{factor.label}</span>
              <small>{factor.detail}</small>
            </li>
          )) : <li>No positive scoring factor recorded.</li>}
        </ul>
        <p className="fine-print">Deterministic factors only. The relationship is not an opaque AI classification.</p>
      </details>
      {!compact && (
        <details>
          <summary>Provenance and release basis</summary>
          <dl className="record-facts">
            <div><dt>Adapter</dt><dd>{record.provenance.adapterId}</dd></div>
            <div><dt>Official domain</dt><dd>{record.provenance.officialDomain}</dd></div>
            <div>
              <dt>{record.provenance.normalizationVersion.includes("researcher-locator") ? "Locator recorded" : "Retrieved"}</dt>
              <dd>{record.retrievalTimestamp}</dd>
            </div>
            <div>
              <dt>Import verification</dt>
              <dd>{record.provenance.importedUnverified ? "Official-domain checked; source provenance not revalidated" : "Not imported, or re-created by a source run"}</dd>
            </div>
            <div><dt>Release basis</dt><dd>{record.review.releaseStatusOverride?.determinationBasis ?? record.releaseStatus.determinationBasis}</dd></div>
            <div><dt>Human review needed</dt><dd>{record.releaseStatus.humanReview ? "Yes" : "No flag from source logic"}</dd></div>
            <div><dt>Digital objects</dt><dd>{record.digitalObjects.length}</dd></div>
          </dl>
        </details>
      )}
      {reviewOpen && (
        <section className="review-panel" aria-label={`Researcher review for ${current(record.title)}`}>
          <h3>Record a human judgment</h3>
          {reviewError && <p className="error-message" role="alert">{reviewError}</p>}
          <div className="review-disposition">
            <button
              className={record.review.disposition === "confirmed_match" ? "active" : ""}
              onClick={() => onUpdate({ ...record, review: { ...record.review, disposition: "confirmed_match", basis, notes, updatedAt: new Date().toISOString() } })}
            >
              Confirm match
            </button>
            <button
              className={record.review.disposition === "rejected_match" ? "active" : ""}
              onClick={() => onUpdate({ ...record, review: { ...record.review, disposition: "rejected_match", basis, notes, updatedAt: new Date().toISOString() } })}
            >
              Reject match
            </button>
            <button
              className={record.review.bestAvailablePublicCopy ? "active" : ""}
              onClick={() => onUpdate({ ...record, review: { ...record.review, bestAvailablePublicCopy: !record.review.bestAvailablePublicCopy, basis, notes, updatedAt: new Date().toISOString() } })}
            >
              {record.review.bestAvailablePublicCopy ? "Best copy designated" : "Designate best public copy"}
            </button>
          </div>
          <label>
            <span>Judgment basis</span>
            <textarea
              value={basis}
              onChange={(event) => {
                setBasis(event.target.value);
                setReviewError("");
              }}
              maxLength={1000}
              placeholder="Record the source and reason for this judgment."
            />
          </label>
          <label>
            <span>Research notes</span>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={5000} />
          </label>
          <label>
            <span>Corrected title</span>
            <input value={correctedTitle} onChange={(event) => setCorrectedTitle(event.target.value)} maxLength={500} />
          </label>
          <label>
            <span>Release-status override</span>
            <select value={sourceStatus} onChange={(event) => setReleaseStatus(event.target.value as ReleaseStatus)}>
              <option value="released_in_full" disabled={!basis.trim()}>Released in full — manual basis required</option>
              <option value="released_in_part">Released in part</option>
              <option value="released_with_redactions_status_unclear">Redactions, status unclear</option>
              <option value="metadata_only">Metadata only</option>
              <option value="described_but_not_digitized">Described but not digitized</option>
              <option value="withdrawal_notice_only">Withdrawal notice only</option>
              <option value="finding_aid_only">Finding aid only</option>
              <option value="not_determined">Not determined</option>
            </select>
          </label>
          {record.classificationMarkings.length > 0 && (
            <fieldset>
              <legend>Detected markings</legend>
              {record.classificationMarkings.map((marking) => (
                <label className="marking-review" key={marking.id}>
                  <input
                    type="checkbox"
                    checked={!marking.falsePositive}
                    onChange={(event) => {
                      const active = event.target.checked;
                      onUpdate({
                        ...record,
                        classificationMarkings: record.classificationMarkings.map((entry) =>
                          entry.id === marking.id ? { ...entry, falsePositive: !active } : entry
                        ),
                        exemptionCodes: marking.code
                          ? active
                            ? [...new Set([...record.exemptionCodes, marking.code])]
                            : record.exemptionCodes.filter((code) => code !== marking.code)
                          : record.exemptionCodes
                      });
                    }}
                  />
                  <span>{marking.code ?? marking.text} · confidence {Math.round(marking.confidence * 100)}%</span>
                </label>
              ))}
            </fieldset>
          )}
          <button
            className="button button-primary"
            onClick={() => {
              if (record.review.releaseStatusOverride?.status === "released_in_full" && !basis.trim()) {
                setReviewError("A released-in-full determination cannot be saved without a recorded basis.");
                return;
              }
              onUpdate({
                ...record,
                title: {
                  ...record.title,
                  researcherOverride:
                    correctedTitle !== record.title.value
                      ? { value: correctedTitle, basis: basis || "Researcher correction", timestamp: new Date().toISOString() }
                      : record.title.researcherOverride
                },
                review: {
                  ...record.review,
                  basis,
                  notes,
                  releaseStatusOverride: record.review.releaseStatusOverride
                    ? {
                        ...record.review.releaseStatusOverride,
                        determinationBasis: basis || record.review.releaseStatusOverride.determinationBasis
                      }
                    : undefined,
                  updatedAt: new Date().toISOString()
                }
              });
              setReviewError("");
            }}
          >
            Save review
          </button>
        </section>
      )}
    </article>
  );
}

export function ResultsPanel({ project, onUpdate, onCompare }: ResultsProps) {
  const [sort, setSort] = useState<"score" | "date" | "title">("score");
  const [source, setSource] = useState("all");
  const [status, setStatus] = useState("all");
  const [agency, setAgency] = useState("all");
  const [documentType, setDocumentType] = useState("all");
  const [exemption, setExemption] = useState("all");
  const [confidence, setConfidence] = useState(0);
  const [compact, setCompact] = useState(false);
  const [groupDuplicates, setGroupDuplicates] = useState(true);
  const sources = distinct(project.records.map((record) => current(record.sourceRepository)));
  const agencies = distinct(project.records.map((record) => current(record.originatingAgency)));
  const types = distinct(project.records.map((record) => current(record.documentType)));
  const exemptions = distinct(project.records.flatMap((record) => record.exemptionCodes));
  const visible = useMemo(() => {
    const records = project.records.filter(
      (record) =>
        (source === "all" || current(record.sourceRepository) === source) &&
        (status === "all" || effectiveStatus(record) === status) &&
        (agency === "all" || current(record.originatingAgency) === agency) &&
        (documentType === "all" || current(record.documentType) === documentType) &&
        (exemption === "all" || record.exemptionCodes.includes(exemption)) &&
        record.confidenceScore >= confidence
    );
    return records.sort((left, right) => {
      if (sort === "score") return right.confidenceScore - left.confidenceScore;
      if (sort === "date") return String(current(left.date) ?? "").localeCompare(String(current(right.date) ?? ""));
      return String(current(left.title)).localeCompare(String(current(right.title)));
    });
  }, [project.records, source, status, agency, documentType, exemption, confidence, sort]);
  const histogram = useMemo(() => {
    const years = project.records.reduce<Record<string, number>>((output, record) => {
      const year = String(current(record.date) ?? "").match(/\b(18|19|20)\d{2}\b/)?.[0];
      if (year) output[year] = (output[year] ?? 0) + 1;
      return output;
    }, {});
    return Object.entries(years).sort(([a], [b]) => a.localeCompare(b)).slice(-20);
  }, [project.records]);
  const maxYear = Math.max(1, ...histogram.map(([, count]) => count));

  return (
    <section className="results-workspace" aria-labelledby="results-heading">
      <header className="results-heading">
        <div>
          <p className="eyebrow">Unified official-source results</p>
          <h2 id="results-heading">{visible.length} of {project.records.length} results</h2>
        </div>
        <div className="view-toggle" aria-label="Result display">
          <button className={!compact ? "active" : ""} onClick={() => setCompact(false)}>Detailed</button>
          <button className={compact ? "active" : ""} onClick={() => setCompact(true)}>Compact</button>
        </div>
      </header>
      {histogram.length > 1 && (
        <div className="histogram" aria-label="Result date histogram">
          {histogram.map(([year, count]) => (
            <div key={year} title={`${year}: ${count} records`}>
              <span style={{ height: `${Math.max(8, (count / maxYear) * 72)}px` }} />
              <small>{year.slice(2)}</small>
            </div>
          ))}
        </div>
      )}
      <div className="result-layout">
        <aside className="filters" aria-label="Result filters">
          <h3>Filter and sort</h3>
          <label><span>Sort</span><select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="score">Match confidence</option><option value="date">Date</option><option value="title">Title</option></select></label>
          <label><span>Repository</span><select value={source} onChange={(event) => setSource(event.target.value)}><option value="all">All repositories</option>{sources.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
          <label><span>Release status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="released_in_full">Full</option><option value="released_in_part">Partial</option><option value="released_with_redactions_status_unclear">Redactions / unclear</option><option value="metadata_only">Metadata only</option><option value="described_but_not_digitized">Not digitized</option><option value="finding_aid_only">Finding aid</option><option value="not_determined">Undetermined</option></select></label>
          <label><span>Agency</span><select value={agency} onChange={(event) => setAgency(event.target.value)}><option value="all">All agencies</option>{agencies.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
          <label><span>Document type</span><select value={documentType} onChange={(event) => setDocumentType(event.target.value)}><option value="all">All types</option>{types.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
          <label><span>Exemption code</span><select value={exemption} onChange={(event) => setExemption(event.target.value)}><option value="all">All codes</option>{exemptions.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
          <label><span>Minimum confidence: {confidence}</span><input type="range" min="0" max="100" step="5" value={confidence} onChange={(event) => setConfidence(Number(event.target.value))} /></label>
          <label className="check-label"><input type="checkbox" checked={groupDuplicates} onChange={(event) => setGroupDuplicates(event.target.checked)} />Show version-group labels</label>
        </aside>
        <div className="result-list">
          {visible.map((record) => {
            const group = groupDuplicates ? project.versionGroups.find((entry) => entry.recordIds.includes(record.id)) : undefined;
            return (
              <RecordCard
                key={record.id}
                record={record}
                compact={compact}
                saved={project.savedRecordIds.includes(record.id)}
                groupLabel={group?.label}
                onSave={() =>
                  onUpdate({
                    ...project,
                    savedRecordIds: project.savedRecordIds.includes(record.id)
                      ? project.savedRecordIds.filter((id) => id !== record.id)
                      : [...project.savedRecordIds, record.id],
                    updatedAt: new Date().toISOString()
                  })
                }
                onCompare={() => onCompare(record.id)}
                onUpdate={(updatedRecord) => onUpdate(updateRecord(project, record.id, () => updatedRecord))}
              />
            );
          })}
          {!visible.length && <p className="empty-filter">No result matches the current filters.</p>}
        </div>
      </div>
    </section>
  );
}
