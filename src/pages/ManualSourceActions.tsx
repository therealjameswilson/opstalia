import { useState } from "react";
import type { FormEvent } from "react";
import type { ManualOfficialRecordInput } from "../search/manual-record";
import type { SourceDefinition, SourceRun } from "../core/types";
import { formatManualHandoffForClipboard } from "../search/manual-handoff";
import { copyText } from "../ui/format";
import { ExternalLink } from "../ui/common";

interface ManualSourceActionsProps {
  run: SourceRun;
  source: SourceDefinition;
  enabled: boolean;
  onOpen: () => void;
  onRecord: (input: ManualOfficialRecordInput) => Promise<void> | void;
}

export function ManualSourceActions({
  run,
  source,
  enabled,
  onOpen,
  onRecord
}: ManualSourceActionsProps) {
  const handoff = run.manualHandoff;
  const [copied, setCopied] = useState(false);
  const [title, setTitle] = useState("");
  const [officialUrl, setOfficialUrl] = useState("");
  const [date, setDate] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [formError, setFormError] = useState("");
  const [recorded, setRecorded] = useState(false);
  if (!handoff) return null;
  const locatorGuidance =
    source.id === "cia"
      ? "Use a CIA Reading Room document page (/readingroom/document/…) or direct Reading Room file—not a CIA search, status, or general publications page."
      : source.id === "state-foia"
        ? "Use the direct State released-document PDF under /DOCUMENTS/…—not the State search-results page."
        : "This adapter currently accepts a direct official record file URL, not a homepage, search page, status page, or general collection page.";

  const submitRecord = async (event: FormEvent) => {
    event.preventDefault();
    if (!enabled) {
      setFormError("Acknowledge the unclassified-use notice and wait for the active source run to finish.");
      return;
    }
    if (!confirmed) {
      setFormError("Confirm the public, unclassified status of the official locator.");
      return;
    }
    setFormError("");
    try {
      await onRecord({ title, officialUrl, date, identifier, note });
      setRecorded(true);
      setTitle("");
      setOfficialUrl("");
      setDate("");
      setIdentifier("");
      setNote("");
      setConfirmed(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "The official result could not be recorded.");
    }
  };

  return (
    <div className="manual-handoff">
      <div className="manual-handoff-actions">
        <button
          type="button"
          className="button button-secondary"
          disabled={!enabled}
          onClick={() => {
            void copyText(formatManualHandoffForClipboard(source, handoff)).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            });
          }}
        >
          {copied ? "Copied" : `Copy ${source.id === "cia" ? "CIA " : ""}search terms`}
        </button>
        {handoff.queryUrl && enabled && (
          <a
            href={handoff.queryUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="button button-primary"
            onClick={onOpen}
          >
            {source.id === "state-foia"
              ? "Open prefilled State search"
              : source.manualSearchLabel ?? "Open official search"}
            <span className="sr-only"> (opens official source in a new tab)</span>
            <span aria-hidden="true"> ↗</span>
          </a>
        )}
        {handoff.queryUrl && !enabled && (
          <button type="button" className="button button-primary" disabled>
            {source.id === "state-foia"
              ? "Open prefilled State search"
              : source.manualSearchLabel ?? "Open official search"}
          </button>
        )}
        {source.officialAccessLinks
          ?.filter(
            (link) =>
              link.url !== handoff.queryUrl &&
              !(source.id === "state-foia" && link.kind === "search")
          )
          .map((link) => (
            <ExternalLink key={link.url} href={link.url}>{link.label}</ExternalLink>
          ))}
      </div>
      {!enabled && (
        <p className="handoff-gate" role="status">
          Acknowledge the unclassified-use notice before copying terms, opening an official search, or recording a locator. Search and recording controls also remain locked while adapters are running.
        </p>
      )}
      <p className="handoff-privacy">
        Nothing opens automatically. Opening a handoff sends these unclassified terms to the official agency site and its service providers; the URL may remain in agency logs and browser history.
      </p>
      <details>
        <summary>Prepared terms, filters, and limitations</summary>
        <dl className="handoff-filters">
          <div><dt>Search text</dt><dd>{handoff.queryText || "No text term; structured filters only"}</dd></div>
          {Object.entries(handoff.appliedFilters).map(([label, value]) => (
            <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
          ))}
        </dl>
        <ul>{handoff.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
      </details>
      <details className="manual-result-entry">
        <summary>Record a result found on the official site</summary>
        <form onSubmit={(event) => void submitRecord(event)}>
          <p>{locatorGuidance} Opstalia stores only the locator and metadata you enter; it does not fetch the document.</p>
          {formError && <p className="error-message" role="alert">{formError}</p>}
          {recorded && <p className="status-message" role="status">Official locator added to this project and Saved Records.</p>}
          <label>
            <span>Official record title</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={500} required disabled={!enabled} />
          </label>
          <label>
            <span>Official record or file URL</span>
            <input
              type="url"
              value={officialUrl}
              onChange={(event) => setOfficialUrl(event.target.value)}
              maxLength={4096}
              placeholder={`https://${source.officialDomains[0]}/…`}
              required
              disabled={!enabled}
            />
          </label>
          <div className="manual-result-grid">
            <label>
              <span>Document date <small>(optional)</small></span>
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} disabled={!enabled} />
            </label>
            <label>
              <span>Case or document number <small>(optional)</small></span>
              <input value={identifier} onChange={(event) => setIdentifier(event.target.value)} maxLength={500} disabled={!enabled} />
            </label>
          </div>
          <label>
            <span>Research note <small>(optional; stays in this local project)</small></span>
            <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} disabled={!enabled} />
          </label>
          <label className="manual-result-confirm">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={!enabled} />
            <span>I confirm this URL identifies an unclassified, publicly released record on the official agency domain.</span>
          </label>
          <button className="button button-primary" type="submit" disabled={!enabled || !confirmed || !title.trim() || !officialUrl.trim()}>
            Add official result
          </button>
        </form>
      </details>
    </div>
  );
}
