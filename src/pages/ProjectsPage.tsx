import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { SearchProject } from "../core/types";
import { clearAllLocalData, deleteProject, parseImportedProject, saveProject } from "../persistence/database";
import { downloadText, projectToJson } from "../reporting/exports";
import { EmptyState, SectionHeading } from "../ui/common";
import { safeFileName } from "../ui/format";

interface ProjectsProps {
  projects: SearchProject[];
  onProjectsChange: () => Promise<void> | void;
  onOpenProject: (project: SearchProject) => void;
  onLoadDemos: () => Promise<void> | void;
}

export function ProjectsPage({ projects, onProjectsChange, onOpenProject, onLoadDemos }: ProjectsProps) {
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const importProject = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const project = parseImportedProject(await file.text());
      project.id = `${project.id}-import-${Date.now()}`;
      project.name = `${project.name} (imported)`;
      project.updatedAt = new Date().toISOString();
      if (project.privateMode) {
        onOpenProject(project);
        return;
      }
      await saveProject(project);
      await onProjectsChange();
      setMessage(`Imported ${project.name}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Import failed.");
    } finally {
      event.target.value = "";
    }
  };
  return (
    <>
      <SectionHeading eyebrow="Browser-local workspace" title="Search projects">
        <p>Export projects before clearing browser data. Private-mode projects never appear here; importing one opens it in memory without saving it.</p>
      </SectionHeading>
      <div className="toolbar project-actions">
        <button className="button button-primary" onClick={() => input.current?.click()}>Import project JSON</button>
        <input ref={input} className="sr-only" type="file" accept="application/json,.json" onChange={importProject} />
        <button className="button button-secondary" onClick={() => void onLoadDemos()}>Install demonstration projects</button>
        <button
          className="button button-danger"
          onClick={async () => {
            if (!window.confirm("Clear all Opstalia projects and preferences stored in this browser? This cannot be undone.")) return;
            await clearAllLocalData();
            await onProjectsChange();
            setMessage("All namespaced Opstalia local data was cleared.");
          }}
        >
          Clear all local data
        </button>
      </div>
      <p role="status" className="status-message">{message}</p>
      {projects.length ? (
        <div className="project-cards">
          {[...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((project) => (
            <article key={project.id} className="folder-card">
              <span className="folder-tab" aria-hidden="true" />
              <header>
                <div>
                  <h2>{project.name}</h2>
                  <p>{project.fixture ? "Checked-in public demonstration fixture" : `Updated ${new Date(project.updatedAt).toLocaleString()}`}</p>
                </div>
                {project.fixture && <span className="fixture-badge">Fixture</span>}
              </header>
              <dl>
                <div><dt>Results</dt><dd>{project.records.length}</dd></div>
                <div><dt>Saved</dt><dd>{project.savedRecordIds.length}</dd></div>
                <div><dt>Sources</dt><dd>{project.sourceRuns.length}</dd></div>
                <div><dt>Groups</dt><dd>{project.versionGroups.length}</dd></div>
              </dl>
              <div className="card-actions">
                <button className="button button-primary" onClick={() => onOpenProject(project)}>Open</button>
                <button
                  className="button button-secondary"
                  onClick={() => downloadText(`${safeFileName(project.name)}.opstalia.json`, projectToJson(project), "application/json")}
                >
                  Export JSON
                </button>
                {!project.fixture && (
                  <button
                    className="text-button danger-text"
                    onClick={async () => {
                      if (!window.confirm(`Delete local project “${project.name}”?`)) return;
                      await deleteProject(project.id);
                      await onProjectsChange();
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState title="No stored projects">
          <p>Create a non-private search, import a project, or install the three verified demonstration projects.</p>
        </EmptyState>
      )}
    </>
  );
}
