import type { NormalizedRecord, ScoreFactor, SearchTarget } from "../core/types";

function value<T>(field?: { value: T; researcherOverride?: { value: T } }): T | undefined {
  return field?.researcherOverride?.value ?? field?.value;
}

function normalize(text?: string): string {
  return (text ?? "")
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLocaleLowerCase();
}

function tokens(text?: string): Set<string> {
  return new Set(normalize(text).split(/\s+/).filter((token) => token.length > 2));
}

function overlap(left?: string, right?: string): number {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / Math.max(a.size, b.size);
}

function add(factors: ScoreFactor[], label: string, points: number, detail: string): void {
  factors.push({ label, points, detail });
}

export function scoreRecord(record: NormalizedRecord, target: SearchTarget): { score: number; factors: ScoreFactor[] } {
  const factors: ScoreFactor[] = [];
  const identifierInput = normalize(target.identifiers ?? target.quickQuery);
  const identifiers = [value(record.documentNumber), value(record.caseNumber), value(record.naraNaid), ...record.extractedIdentifiers]
    .filter(Boolean)
    .map((item) => normalize(String(item)));
  if (identifierInput && identifiers.some((identifier) => identifierInput.includes(identifier) || identifier.includes(identifierInput))) {
    add(factors, "Exact identifier match", 35, identifiers.find((identifier) => identifierInput.includes(identifier)) ?? identifierInput);
  }

  const targetTitle = target.titleOrSubject ?? target.quickQuery;
  const recordTitle = value(record.title);
  const titleOverlap = overlap(targetTitle, recordTitle);
  if (normalize(targetTitle) && normalize(targetTitle) === normalize(recordTitle)) add(factors, "Exact title match", 25, recordTitle ?? "");
  else if (titleOverlap >= 0.45) add(factors, "Title similarity", Math.round(18 * titleOverlap), `${Math.round(titleOverlap * 100)}% token overlap`);

  const recordDate = value(record.date);
  if (target.dateFrom && recordDate?.startsWith(target.dateFrom)) add(factors, "Exact date match", 20, recordDate);
  else if (target.dateFrom && recordDate && recordDate.slice(0, 4) !== target.dateFrom.slice(0, 4)) {
    add(factors, "Date conflict", -10, `${recordDate} conflicts with ${target.dateFrom}`);
  } else if (target.dateFrom && recordDate?.slice(0, 4) === target.dateFrom.slice(0, 4)) add(factors, "Year match", 8, recordDate);

  const sender = value(record.authorSender)?.join(" ");
  if (overlap(target.authorSender, sender) > 0.4) add(factors, "Sender match", 15, sender ?? "");
  const recipient = value(record.recipient)?.join(" ");
  if (overlap(target.recipient, recipient) > 0.4) add(factors, "Recipient match", 10, recipient ?? "");

  const agency = value(record.originatingAgency);
  const office = value(record.office);
  const agencyOverlap = overlap(target.originatingAgency, agency);
  const officeOverlap = overlap(target.originatingOffice, office);
  if (agencyOverlap > 0.4 || officeOverlap > 0.4) {
    add(
      factors,
      "Agency or office match",
      10,
      officeOverlap > agencyOverlap ? office ?? "" : agency ?? ""
    );
  }
  const documentType = value(record.documentType);
  if (overlap(target.documentType, documentType) > 0.4) add(factors, "Document-type match", 7, documentType ?? "");
  const snippet = value(record.textSnippet);
  const phrase = target.exactPhrase?.replaceAll('"', "");
  if (phrase && normalize(snippet).includes(normalize(phrase))) add(factors, "Exact phrase match", 18, phrase);

  const recordSearchText = [recordTitle, snippet, value(record.subject)?.join(" ")].filter(Boolean).join(" ");
  const geographicOverlap = overlap(target.geographicFocus, recordSearchText);
  if (geographicOverlap > 0.15) {
    add(factors, "Geographic match", Math.min(6, Math.max(2, Math.round(geographicOverlap * 8))), target.geographicFocus ?? "");
  }
  const keywordOverlap = overlap(
    [target.generalKeywords, target.quickQuery].filter(Boolean).join(" "),
    recordSearchText
  );
  if (keywordOverlap > 0.1) add(factors, "Keyword overlap", Math.min(10, Math.round(keywordOverlap * 12)), `${Math.round(keywordOverlap * 100)}% overlap`);

  return {
    score: Math.max(0, Math.min(100, factors.reduce((sum, factor) => sum + factor.points, 0))),
    factors
  };
}
