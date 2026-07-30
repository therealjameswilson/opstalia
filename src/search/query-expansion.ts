import type { QueryKind, SearchPlan, SearchQuery, SearchTarget } from "../core/types";
import { makeId } from "../core/id";
import { sanitizePlainText } from "../core/validation";
import { extractIdentifiers } from "../analysis/identifiers";

const ACRONYMS: Record<string, string> = {
  cia: "Central Intelligence Agency",
  dod: "Department of Defense",
  doe: "Department of Energy",
  fbi: "Federal Bureau of Investigation",
  foia: "Freedom of Information Act",
  frus: "Foreign Relations of the United States",
  mdr: "Mandatory Declassification Review",
  nara: "National Archives and Records Administration",
  ndc: "National Declassification Center",
  nro: "National Reconnaissance Office",
  nsa: "National Security Agency",
  nsc: "National Security Council",
  iscap: "Interagency Security Classification Appeals Panel"
};

const SOURCE_STRATEGY = [
  "Search NARA Catalog metadata and digital objects, including exact NAIDs and archival identifiers.",
  "Search the official FRUS corpus for published document text, dates, persons, source notes, and editorial context.",
  "Search the ISCAP release index for appeal numbers, titles, originating agencies, and official released files.",
  "When selected, search NARA's official JFK release-file index by exact RIF and filename metadata; do not use unofficial converted text as release evidence.",
  "Offer official manual-search links when an agency does not expose a stable, permissible automated search interface.",
  "Keep failed sources isolated and preserve the exact source status in the research report."
];

function addQuery(
  output: SearchQuery[],
  kind: QueryKind,
  label: string,
  text: string | undefined,
  explanation: string,
  sourceIds: string[] = ["nara", "frus", "iscap", "ndc"]
): void {
  const clean = text ? sanitizePlainText(text) : "";
  if (!clean || output.some((item) => item.text.toLocaleLowerCase() === clean.toLocaleLowerCase())) return;
  output.push({
    id: makeId("query", `${kind}|${clean}`),
    label,
    text: clean,
    kind,
    enabled: true,
    sourceIds,
    explanation
  });
}

function words(value?: string): string[] {
  return (value ?? "")
    .split(/[,;\n]|\s+(?:and|or)\s+/i)
    .map((part) => sanitizePlainText(part))
    .filter((part) => part.length > 1);
}

function nameVariants(value?: string): string[] {
  return words(value).flatMap((name) => {
    const parts = name.split(/\s+/);
    if (parts.length < 2) return [name];
    return [name, `${parts.at(-1)}, ${parts.slice(0, -1).join(" ")}`, parts.at(-1) ?? name];
  });
}

function ocrVariant(value: string): string {
  return value
    .replace(/[-–—]/g, " ")
    .replace(/\b([A-Z])\.?\s*([A-Z])\.?\b/g, "$1 $2")
    .replace(/[1I]/g, "[1I]")
    .replace(/[0O]/g, "[0O]");
}

function spellingVariants(value: string): string[] {
  const variants: string[] = [];
  if (/gorbachev/i.test(value)) variants.push(value.replace(/gorbachev/gi, "Gorbachev Gorbachev"));
  if (/scowcroft/i.test(value)) variants.push(value.replace(/scowcroft/gi, "Scowcroft Scowcraft"));
  if (/yugoslav/i.test(value)) variants.push(value.replace(/yugoslav/gi, "Yugoslav Yugoslavia"));
  return variants;
}

export function buildSearchPlan(target: SearchTarget): SearchPlan {
  const queries: SearchQuery[] = [];
  const broadParts = [
    target.quickQuery,
    target.titleOrSubject,
    target.generalKeywords,
    target.originatingAgency,
    target.originatingOffice,
    target.authorSender,
    target.recipient,
    target.geographicFocus,
    target.documentType
  ].filter(Boolean) as string[];

  if (target.exactPhrase) {
    addQuery(queries, "exact_phrase", "Exact phrase", `"${target.exactPhrase.replaceAll('"', "")}"`, "Preserves the supplied phrase.");
  }

  for (const identifier of extractIdentifiers(
    target.identifiers || target.quickQuery || ""
  )) {
    addQuery(
      queries,
      "identifier",
      `Identifier: ${identifier}`,
      identifier,
      "Searches the exact normalized identifier."
    );
  }

  addQuery(
    queries,
    "broad_keyword",
    "Broad metadata search",
    broadParts.join(" "),
    "Combines the supplied title, people, place, type, and keywords."
  );

  if (target.titleOrSubject && target.authorSender) {
    addQuery(
      queries,
      "broad_keyword",
      "Title and sender",
      `${target.titleOrSubject} ${target.authorSender}`,
      "Prioritizes a likely title or subject with the sender."
    );
  }

  for (const name of [...nameVariants(target.authorSender), ...nameVariants(target.recipient)].slice(0, 8)) {
    addQuery(queries, "name_variant", `Name variant: ${name}`, name, "Accounts for inverted names and surname-only indexing.");
  }

  const allText = broadParts.join(" ");
  for (const [short, expansion] of Object.entries(ACRONYMS)) {
    const shortPattern = new RegExp(`\\b${short}\\b`, "i");
    const longPattern = new RegExp(expansion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    if (shortPattern.test(allText)) {
      addQuery(
        queries,
        "acronym_expansion",
        `${short.toUpperCase()} expansion`,
        allText.replace(shortPattern, expansion),
        "Expands an agency or records-management acronym."
      );
    } else if (longPattern.test(allText)) {
      addQuery(
        queries,
        "acronym_expansion",
        `${short.toUpperCase()} variant`,
        `${allText} ${short.toUpperCase()}`,
        "Adds the common acronym used in archival description."
      );
    }
  }

  if (target.originatingAgency) {
    addQuery(
      queries,
      "agency_variant",
      "Agency-specific variant",
      `${target.originatingAgency} ${target.titleOrSubject ?? target.generalKeywords ?? target.quickQuery ?? ""}`,
      "Adds the originating agency to the primary terms."
    );
  }

  if (target.dateFrom || target.dateTo) {
    const dates = [target.dateFrom, target.dateTo].filter(Boolean).join(" to ");
    addQuery(
      queries,
      "date_variant",
      "Date-bounded variant",
      `${broadParts.slice(0, 3).join(" ")} ${dates}`,
      "Includes human-readable boundary dates while adapters also apply structured date filters."
    );
  }

  if (allText) {
    addQuery(queries, "ocr_tolerant", "OCR-tolerant variant", ocrVariant(allText), "Accounts for punctuation and common OCR character confusion.");
    for (const variant of spellingVariants(allText)) {
      addQuery(queries, "spelling_variant", "Likely spelling variant", variant, "Adds a cautious, deterministic spelling alternative.");
    }
  }

  return {
    id: makeId("plan"),
    createdAt: new Date().toISOString(),
    target,
    queries: queries.slice(0, 16),
    sourceSelectionStrategy: SOURCE_STRATEGY
  };
}
