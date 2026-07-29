import { makeId } from "../core/id";
import type {
  NormalizedRecord,
  VersionGroup,
  VersionRelationship,
  VersionRelationshipLabel
} from "../core/types";

function raw<T>(field?: { value: T; researcherOverride?: { value: T } }): T | undefined {
  return field?.researcherOverride?.value ?? field?.value;
}

function normalized(value?: string): string {
  return (value ?? "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function tokenSimilarity(left?: string, right?: string): number {
  const a = new Set(normalized(left).split(/\s+/).filter(Boolean));
  const b = new Set(normalized(right).split(/\s+/).filter(Boolean));
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / (a.size + b.size - intersection);
}

function labelFor(score: number, strongIdentifier: boolean): VersionRelationshipLabel {
  if (strongIdentifier && score >= 90) return "confirmed_same_document";
  if (score >= 72) return "probable_version";
  if (score >= 48) return "possible_version";
  if (score >= 25) return "related_record";
  return "insufficient_evidence";
}

export function compareVersions(left: NormalizedRecord, right: NormalizedRecord): VersionRelationship {
  let score = 0;
  let strongIdentifier = false;
  const reasons: string[] = [];
  const leftIds = [raw(left.documentNumber), raw(left.caseNumber), raw(left.archivalCitation), raw(left.naraNaid), ...left.extractedIdentifiers]
    .filter(Boolean)
    .map((item) => normalized(String(item)));
  const rightIds = [raw(right.documentNumber), raw(right.caseNumber), raw(right.archivalCitation), raw(right.naraNaid), ...right.extractedIdentifiers]
    .filter(Boolean)
    .map((item) => normalized(String(item)));
  const commonIds = leftIds.filter((identifier) => identifier.length > 3 && rightIds.includes(identifier));
  if (commonIds.length) {
    score += 55;
    strongIdentifier = true;
    reasons.push(`Same identifier: ${commonIds[0]}`);
  }

  const leftDate = raw(left.date);
  const rightDate = raw(right.date);
  if (leftDate && rightDate && leftDate === rightDate) {
    score += 15;
    reasons.push(`Same recorded date: ${leftDate}`);
  }

  const titleSimilarity = tokenSimilarity(raw(left.title), raw(right.title));
  if (titleSimilarity > 0.5) {
    score += Math.round(titleSimilarity * 20);
    reasons.push(`Similar titles (${Math.round(titleSimilarity * 100)}%)`);
  }

  const senders = tokenSimilarity(raw(left.authorSender)?.join(" "), raw(right.authorSender)?.join(" "));
  const recipients = tokenSimilarity(raw(left.recipient)?.join(" "), raw(right.recipient)?.join(" "));
  if (senders > 0.6) {
    score += 10;
    reasons.push("Same or highly similar sender");
  }
  if (recipients > 0.6) {
    score += 10;
    reasons.push("Same or highly similar recipient");
  }
  const leftPages = raw(left.pageCount);
  const rightPages = raw(right.pageCount);
  if (leftPages && rightPages && leftPages === rightPages) {
    score += 6;
    reasons.push(`Same page count: ${leftPages}`);
  }
  const textSimilarity = tokenSimilarity(raw(left.textSnippet), raw(right.textSnippet));
  if (textSimilarity > 0.65) {
    score += Math.round(textSimilarity * 15);
    reasons.push(`Similar available text (${Math.round(textSimilarity * 100)}%)`);
  }
  if (left.provenance.officialRecordUrl === right.provenance.officialRecordUrl) {
    score += 40;
    strongIdentifier = true;
    reasons.push("Same official record URL");
  }
  score = Math.min(100, score);
  return {
    id: makeId("relationship", [left.id, right.id].sort().join("|")),
    leftRecordId: left.id,
    rightRecordId: right.id,
    label: labelFor(score, strongIdentifier),
    score,
    reasons: reasons.length ? reasons : ["No reliable document-level equivalence signal"]
  };
}

export function groupVersions(records: NormalizedRecord[]): VersionGroup[] {
  const groups: VersionGroup[] = [];
  const assigned = new Set<string>();
  for (const record of records) {
    if (assigned.has(record.id)) continue;
    const relationships: VersionRelationship[] = [];
    const groupRecords = [record];
    for (const candidate of records) {
      if (candidate.id === record.id || assigned.has(candidate.id)) continue;
      const relationship = compareVersions(record, candidate);
      if (["confirmed_same_document", "probable_version", "possible_version"].includes(relationship.label)) {
        relationships.push(relationship);
        groupRecords.push(candidate);
      }
    }
    if (groupRecords.length > 1) {
      for (const item of groupRecords) assigned.add(item.id);
      groups.push({
        id: makeId("version-group", groupRecords.map((item) => item.id).sort().join("|")),
        label: raw(record.title) || "Possible record versions",
        recordIds: groupRecords.map((item) => item.id),
        relationships,
        reviewStatus: "awaiting_review"
      });
    }
  }
  return groups;
}

export function deduplicateRecords(records: NormalizedRecord[]): NormalizedRecord[] {
  const seen = new Map<string, NormalizedRecord>();
  for (const record of records) {
    const key = [
      record.provenance.sourceId,
      raw(record.documentNumber) ?? raw(record.naraNaid) ?? "",
      record.provenance.officialRecordUrl
    ].join("|");
    const current = seen.get(key);
    if (!current || record.confidenceScore > current.confidenceScore) seen.set(key, record);
  }
  return [...seen.values()];
}
