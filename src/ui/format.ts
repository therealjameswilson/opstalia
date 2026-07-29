import type { NormalizedRecord, ReleaseStatus, SourcedValue } from "../core/types";

export function current<T>(field?: SourcedValue<T>): T | undefined {
  return field?.researcherOverride?.value ?? field?.value;
}

export function formatStatus(status: ReleaseStatus): string {
  const labels: Record<ReleaseStatus, string> = {
    released_in_full: "Full",
    released_in_part: "Partial",
    released_with_redactions_status_unclear: "Redactions — status unclear",
    metadata_only: "Metadata only",
    described_but_not_digitized: "Not digitized",
    withdrawal_notice_only: "Withdrawal notice",
    finding_aid_only: "Finding aid",
    not_determined: "Undetermined"
  };
  return labels[status];
}

export function effectiveStatus(record: NormalizedRecord): ReleaseStatus {
  return record.review.releaseStatusOverride?.status ?? record.releaseStatus.status;
}

export function formatDate(value?: string): string {
  if (!value) return "Date unknown";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(
      new Date(`${value}T00:00:00Z`)
    );
  }
  return value;
}

export function safeFileName(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "opstalia-report";
}

export function copyText(value: string): Promise<void> {
  return navigator.clipboard.writeText(value);
}
