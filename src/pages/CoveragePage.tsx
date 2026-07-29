import { useMemo, useState } from "react";
import { activeSourceCounts, sourcePolicyStatement, sourceRegistry, sourceRegistryValidated } from "../data/registry";
import type { AdapterStatus } from "../core/types";
import { ExternalLink, SectionHeading } from "../ui/common";

export function CoveragePage() {
  const [filter, setFilter] = useState<AdapterStatus | "all">("all");
  const [query, setQuery] = useState("");
  const counts = activeSourceCounts();
  const visible = useMemo(
    () =>
      sourceRegistry.filter(
        (source) =>
          (filter === "all" || source.adapterStatus === filter) &&
          `${source.displayName} ${source.agency} ${source.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())
      ),
    [filter, query]
  );

  return (
    <>
      <SectionHeading eyebrow="Source registry · validated 2026-07-29" title="Source coverage">
        <p>{sourcePolicyStatement} Automated status means a real adapter exists; manual status means Opstalia opens the official search system without pretending to normalize results.</p>
      </SectionHeading>
      <section className="coverage-summary">
        {(["integrated", "beta", "manual", "temporarily_unavailable", "planned", "retired"] as AdapterStatus[]).map((status) => (
          <button key={status} className={filter === status ? "active" : ""} onClick={() => setFilter(filter === status ? "all" : status)}>
            <span className={`status-dot source-${status}`} aria-hidden="true" />
            <strong>{counts[status] ?? 0}</strong>
            <span>{status.replaceAll("_", " ")}</span>
          </button>
        ))}
      </section>
      <div className="toolbar">
        <label>
          <span>Filter registered sources</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Agency or repository" />
        </label>
        <span>{visible.length} of {sourceRegistry.length} sources</span>
      </div>
      <div className="table-scroll">
        <table className="coverage-table">
          <caption className="sr-only">Official source registry, capabilities, and known limitations</caption>
          <thead>
            <tr>
              <th scope="col">Source</th>
              <th scope="col">Status</th>
              <th scope="col">Method</th>
              <th scope="col">Authentication</th>
              <th scope="col">Limitations</th>
              <th scope="col">Official access</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((source) => (
              <tr key={source.id}>
                <th scope="row">
                  <strong>{source.displayName}</strong>
                  <span>{source.agency}</span>
                  <small>{source.description}</small>
                </th>
                <td><span className={`coverage-pill source-${source.adapterStatus}`}>{source.adapterStatus.replaceAll("_", " ")}</span></td>
                <td>
                  <strong>{source.searchCapability}</strong>
                  <small>{source.implementationMethod}</small>
                  <details>
                    <summary>Technical notes</summary>
                    <p><b>API:</b> {source.apiAvailability}</p>
                    <p><b>Rate:</b> {source.rateLimit}</p>
                    <p><b>Robots/terms:</b> {source.robotsAndTerms}</p>
                  </details>
                </td>
                <td>{source.authentication}</td>
                <td>
                  <ul>{source.knownLimitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
                </td>
                <td><ExternalLink href={source.manualSearchUrl}>Open official source</ExternalLink></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="validation-note">Registry version 1.0.0 · last source-interface validation {sourceRegistryValidated}.</p>
    </>
  );
}
