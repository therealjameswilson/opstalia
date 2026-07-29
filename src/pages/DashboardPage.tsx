import { useEffect, useMemo, useState } from "react";
import type { SearchProject } from "../core/types";
import { activeSourceCounts, sourceRegistry, sourceRegistryValidated } from "../data/registry";
import { checkBackendHealth } from "../search/client";
import { EmptyState, SectionHeading } from "../ui/common";

interface DashboardProps {
  projects: SearchProject[];
  onNavigate: (view: string) => void;
  onOpenProject: (project: SearchProject) => void;
}

export function DashboardPage({ projects, onNavigate, onOpenProject }: DashboardProps) {
  const counts = activeSourceCounts();
  const [health, setHealth] = useState({ ready: false, message: "Checking Worker…" });
  useEffect(() => {
    const controller = new AbortController();
    void checkBackendHealth(controller.signal).then(setHealth);
    return () => controller.abort();
  }, []);
  const metrics = useMemo(() => {
    const saved = projects.reduce((sum, project) => sum + project.savedRecordIds.length, 0);
    const groups = projects.reduce(
      (sum, project) => sum + project.versionGroups.filter((group) => group.reviewStatus === "awaiting_review").length,
      0
    );
    return { saved, groups };
  }, [projects]);
  const recent = [...projects].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 5);

  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">OPSTALIA 1.0 · UNCLASSIFIED INTERNET APPLICATION</p>
          <h1>Search the official record of declassification.</h1>
          <p>
            Define a record using unclassified metadata. Build an explainable plan. Search supported official repositories.
            Compare public versions without losing provenance.
          </p>
          <div className="hero-actions">
            <button className="button button-primary" onClick={() => onNavigate("new-search")}>Begin an unclassified search</button>
            <button className="button button-secondary" onClick={() => onNavigate("coverage")}>Review source coverage</button>
          </div>
        </div>
        <aside className="boundary-card" aria-label="System boundary">
          <span className="stamp-outline">PUBLIC · UNCLASSIFIED</span>
          <h2>Internet-only in version 1.0</h2>
          <p>Opstalia 1.0 does not connect or synchronize with Opstalia-c or any closed network.</p>
          <p>Future synchronization would require separate authorization, security engineering, and review. It is not implemented.</p>
        </aside>
      </section>

      <section className="metrics" aria-label="Research dashboard">
        <button onClick={() => onNavigate("coverage")} className="metric-card">
          <strong>{(counts.integrated ?? 0) + (counts.beta ?? 0)}</strong>
          <span>automated adapters</span>
          <small>{sourceRegistry.length} registered official sources</small>
        </button>
        <button onClick={() => onNavigate("coverage")} className="metric-card">
          <strong className={health.ready ? "healthy-text" : "warning-text"}>{health.ready ? "Ready" : "Setup"}</strong>
          <span>backend status</span>
          <small>{health.message}</small>
        </button>
        <button onClick={() => onNavigate("saved")} className="metric-card">
          <strong>{metrics.saved}</strong>
          <span>saved record locators</span>
          <small>across local projects</small>
        </button>
        <button onClick={() => onNavigate("compare")} className="metric-card">
          <strong>{metrics.groups}</strong>
          <span>version groups</span>
          <small>awaiting researcher review</small>
        </button>
      </section>

      <section className="dashboard-grid">
        <div className="panel">
          <header className="panel-heading">
            <div>
              <p className="eyebrow">Local research</p>
              <h2>Recent search projects</h2>
            </div>
            <button className="text-button" onClick={() => onNavigate("projects")}>View all</button>
          </header>
          {recent.length ? (
            <ol className="project-list">
              {recent.map((project) => (
                <li key={project.id}>
                  <button onClick={() => onOpenProject(project)}>
                    <span className="folder-tab" aria-hidden="true" />
                    <span>
                      <strong>{project.name}</strong>
                      <small>
                        {project.records.length} results · {project.sourceRuns.length} source runs ·{" "}
                        {new Date(project.updatedAt).toLocaleString()}
                      </small>
                    </span>
                    {project.fixture && <span className="fixture-badge">Fixture</span>}
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState title="No local projects yet" action={<button className="button button-primary" onClick={() => onNavigate("new-search")}>Create a search</button>}>
              <p>Projects are stored in this browser unless private mode is enabled.</p>
            </EmptyState>
          )}
        </div>
        <aside className="panel source-snapshot">
          <p className="eyebrow">Coverage snapshot</p>
          <h2>Registry validated {sourceRegistryValidated}</h2>
          <dl>
            {Object.entries(counts).map(([status, count]) => (
              <div key={status}>
                <dt><span className={`status-dot source-${status}`} aria-hidden="true" />{status.replaceAll("_", " ")}</dt>
                <dd>{count}</dd>
              </div>
            ))}
          </dl>
          <p className="fine-print">Opstalia searches its current registry of supported official repositories. It does not claim exhaustive government coverage.</p>
        </aside>
      </section>

      <section className="caveat-band">
        <SectionHeading eyebrow="Interpretive discipline" title="A search result is a lead, not a legal conclusion.">
          <p>Absence does not prove non-release. Digitized does not mean declassified. A less-redacted copy is not automatically more authentic.</p>
        </SectionHeading>
      </section>
    </>
  );
}
