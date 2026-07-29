import type { SearchProject } from "../core/types";
import { EmptyState, ExternalLink, SectionHeading, SourceBadge, StatusStamp } from "../ui/common";
import { current, effectiveStatus, formatDate } from "../ui/format";

export function SavedPage({
  projects,
  onOpenProject,
  onCompare
}: {
  projects: SearchProject[];
  onOpenProject: (project: SearchProject) => void;
  onCompare: (recordIds: string[]) => void;
}) {
  const saved = projects.flatMap((project) =>
    project.records
      .filter((record) => project.savedRecordIds.includes(record.id))
      .map((record) => ({ project, record }))
  );
  return (
    <>
      <SectionHeading eyebrow="Browser-local locators" title="Saved records">
        <p>Saved NARA items contain a generated NAID/official-URL locator, not cached NARA API content. Other indexed-source records retain their normalized public metadata.</p>
      </SectionHeading>
      {saved.length ? (
        <div className="saved-grid">
          {saved.map(({ project, record }) => (
            <article key={`${project.id}-${record.id}`} className="saved-card">
              <header>
                <SourceBadge>{current(record.sourceRepository)}</SourceBadge>
                <StatusStamp status={effectiveStatus(record)} />
              </header>
              <h2>{current(record.title)}</h2>
              <p>{formatDate(current(record.date))}</p>
              <small>Project: <button className="text-button" onClick={() => onOpenProject(project)}>{project.name}</button></small>
              <div className="card-actions">
                <ExternalLink href={current(record.officialUrl) ?? "#"}>Official record</ExternalLink>
                <button className="text-button" onClick={() => onCompare([record.id])}>Compare</button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState title="No saved records">
          <p>Save official-source result cards from a search project to create a durable research queue.</p>
        </EmptyState>
      )}
    </>
  );
}
