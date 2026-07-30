import type { PropsWithChildren, ReactNode } from "react";
import type { ReleaseStatus } from "../core/types";
import { formatStatus } from "./format";

export function StatusStamp({ status }: { status: ReleaseStatus }) {
  return (
    <span className={`status-stamp status-${status}`} aria-label={`Release status: ${formatStatus(status)}`}>
      {formatStatus(status)}
    </span>
  );
}

export function SourceBadge({ children }: PropsWithChildren) {
  return <span className="source-badge">{children}</span>;
}

export function Confidence({ score }: { score: number }) {
  const level = score >= 75 ? "high" : score >= 45 ? "medium" : "low";
  return (
    <span className={`confidence confidence-${level}`} aria-label={`Match confidence ${score} out of 100`}>
      <span aria-hidden="true">{score}</span>
      <small>/100</small>
    </span>
  );
}

export function EmptyState({ title, children, action }: PropsWithChildren<{ title: string; action?: ReactNode }>) {
  return (
    <section className="empty-state">
      <div className="empty-icon" aria-hidden="true">◇</div>
      <h2>{title}</h2>
      <div>{children}</div>
      {action}
    </section>
  );
}

export function FieldProvenance({
  kind
}: {
  kind: "source" | "extracted" | "inferred" | "researcher" | "corrected";
}) {
  const labels = {
    source: "Source-reported",
    extracted: "Automatically extracted",
    inferred: "Algorithmically inferred",
    researcher: "Researcher confirmed",
    corrected: "Researcher corrected"
  };
  return <span className={`provenance-label provenance-${kind}`}>{labels[kind]}</span>;
}

export function ExternalLink({ href, children, className }: PropsWithChildren<{ href: string; className?: string }>) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
      <span className="sr-only"> (opens official source in a new tab)</span>
      <span aria-hidden="true"> ↗</span>
    </a>
  );
}

export function SectionHeading({ eyebrow, title, children }: PropsWithChildren<{ eyebrow?: string; title: string }>) {
  return (
    <header className="section-heading">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h1>{title}</h1>
      {children && <div className="lede">{children}</div>}
    </header>
  );
}
