import type {
  ManualSearchHandoff,
  QueryKind,
  SearchPlan,
  SearchTarget,
  SourceDefinition
} from "../core/types";
import { sanitizePlainText } from "../core/validation";

const STATE_SEARCH_URL = "https://foia.state.gov/FOIALIBRARY/SearchResults.aspx";
const MAX_HANDOFF_QUERY_LENGTH = 1000;

const STATE_DOCUMENT_TYPES: Array<{ pattern: RegExp; parameter: string; label: string }> = [
  { pattern: /\bemail\b/i, parameter: "email", label: "Email" },
  { pattern: /\b(?:telegram|cable)\b/i, parameter: "telegram", label: "Telegram" },
  { pattern: /\bmemo(?:randum)?\b/i, parameter: "ME", label: "Memorandum" },
  { pattern: /\bgeneral correspondence\b/i, parameter: "GC", label: "General correspondence" },
  { pattern: /\bcongressional correspondence\b/i, parameter: "CC", label: "Congressional correspondence" },
  { pattern: /\bmeeting document\b/i, parameter: "MD", label: "Meeting document" },
  { pattern: /\bpress release\b/i, parameter: "PR", label: "Press release" },
  { pattern: /\bschedule\b/i, parameter: "SC", label: "Schedule" },
  { pattern: /\breport\b/i, parameter: "RP", label: "Report" },
  { pattern: /\b(?:translation|foreign language)\b/i, parameter: "TN", label: "Translation or foreign-language document" },
  { pattern: /\bdiplomatic document\b/i, parameter: "DD", label: "Diplomatic document" },
  { pattern: /\bcontract(?:ing)? document\b/i, parameter: "CD", label: "Contracting document" },
  { pattern: /\bmicrofiche\b/i, parameter: "MF", label: "Microfiche" },
  { pattern: /\bmisc(?:ellaneous)?\b/i, parameter: "misc", label: "Miscellaneous" }
];

export function manualQueryText(plan: SearchPlan): string {
  const enabled = plan.queries.filter((query) => query.enabled && query.text.trim());
  const preferred = [
    enabled.find((query) => query.kind === "exact_phrase"),
    enabled.find((query) => query.kind === "broad_keyword")
  ].filter((query): query is SearchPlan["queries"][number] => Boolean(query));
  const selected = preferred.length ? preferred : enabled.slice(0, 1);
  const seen = new Set<string>();
  return selected
    .map((query) => sanitizePlainText(query.text).trim())
    .filter((text) => {
      const key = text.toLocaleLowerCase();
      if (!text || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(" ")
    .slice(0, MAX_HANDOFF_QUERY_LENGTH)
    .trim();
}

function stateSafeText(value: string, maximumLength: number): string {
  return sanitizePlainText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/[^A-Za-z0-9\s"' ._-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximumLength)
    .trim();
}

function encodeStateValue(value: string): string {
  // State's current client parser recognizes %20 and %22 but does not reliably
  // decode URLSearchParams' "+" spaces or other structural escapes.
  return encodeURIComponent(value);
}

function stateDate(value?: string): string | undefined {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[2]}-${match[3]}-${match[1]}` : undefined;
}

function hasEnabledKind(plan: SearchPlan, kind: QueryKind): boolean {
  return plan.queries.some((query) => query.enabled && query.kind === kind && query.text.trim());
}

function enabledQueryContains(plan: SearchPlan, value?: string): boolean {
  const needle = sanitizePlainText(value ?? "").trim().toLocaleLowerCase();
  return Boolean(
    needle &&
    plan.queries.some(
      (query) =>
        query.enabled &&
        sanitizePlainText(query.text).toLocaleLowerCase().includes(needle)
    )
  );
}

function stateCaseNumber(plan: SearchPlan, target: SearchTarget): string | undefined {
  if (!hasEnabledKind(plan, "identifier")) return undefined;
  const candidate = `${target.identifiers ?? ""} ${target.quickQuery ?? ""}`;
  const match = candidate.match(/\b(?:F|MDR)-?\d{4}-\d{3,6}(?:-DOCS?\d+)?\b/i);
  return match ? stateSafeText(match[0].toUpperCase(), 100) : undefined;
}

export function buildStateFoiaHandoff(plan: SearchPlan): ManualSearchHandoff {
  const queryText = stateSafeText(manualQueryText(plan), 350);
  const useNameFilters = hasEnabledKind(plan, "name_variant");
  const from = useNameFilters ? stateSafeText(plan.target.authorSender ?? "", 150) : "";
  const to = useNameFilters ? stateSafeText(plan.target.recipient ?? "", 150) : "";
  const caseNumber = stateCaseNumber(plan, plan.target);
  const useDateFilters = hasEnabledKind(plan, "date_variant");
  const beginDate = useDateFilters ? stateDate(plan.target.dateFrom) : undefined;
  const endDate = useDateFilters ? stateDate(plan.target.dateTo) : undefined;
  const type = enabledQueryContains(plan, plan.target.documentType)
    ? STATE_DOCUMENT_TYPES.find((entry) => entry.pattern.test(plan.target.documentType ?? ""))
    : undefined;
  const parameters: Array<[string, string]> = [];
  const appliedFilters: Record<string, string> = {};

  const add = (key: string, value: string | undefined, label: string) => {
    if (!value) return;
    parameters.push([key, value]);
    appliedFilters[label] = value;
  };

  add("searchText", queryText, "Search text");
  add("beginDate", beginDate, "Document date from");
  add("endDate", endDate, "Document date to");
  add("caseNumber", caseNumber, "FOIA case number");
  add("DocFrom", from, "Sender");
  add("DocTo", to, "Recipient");
  if (type) {
    parameters.push([type.parameter, "true"]);
    appliedFilters["Document type"] = type.label;
  }

  const queryString = parameters
    .map(([key, value]) => `${key}=${encodeStateValue(value)}`)
    .join("&");

  return {
    queryText,
    queryUrl: queryString ? `${STATE_SEARCH_URL}?${queryString}` : STATE_SEARCH_URL,
    appliedFilters,
    status: "prepared",
    warnings: [
      "This is a user-initiated handoff. Opstalia does not call State's undocumented search API or retrieve its results.",
      "Opening the link transmits the prepared terms to foia.state.gov; the official site and its service providers may receive them, and the URL may remain in browser history.",
      "State warns that OCR errors and incomplete metadata can affect retrieval."
    ]
  };
}

export function buildManualSearchHandoff(
  source: SourceDefinition,
  plan: SearchPlan
): ManualSearchHandoff {
  if (source.id === "state-foia") return buildStateFoiaHandoff(plan);
  const queryText = manualQueryText(plan);
  if (source.id === "cia") {
    const useDates = hasEnabledKind(plan, "date_variant");
    const useNames = hasEnabledKind(plan, "name_variant");
    const useIdentifier = hasEnabledKind(plan, "identifier");
    return {
      queryText,
      queryUrl: source.manualSearchUrl,
      appliedFilters: Object.fromEntries(
        [
          ["Date from", useDates ? plan.target.dateFrom : undefined],
          ["Date to", useDates ? plan.target.dateTo : undefined],
          ["Sender", useNames ? plan.target.authorSender : undefined],
          ["Recipient", useNames ? plan.target.recipient : undefined],
          ["Identifier", useIdentifier ? plan.target.identifiers : undefined]
        ].filter((entry): entry is [string, string] => Boolean(entry[1]))
      ),
      status: "unavailable",
      warnings: [
        "CIA's official Electronic Reading Room is currently returning a redirect loop.",
        "Opstalia does not bypass CIA access controls or automate robots-disallowed search pages.",
        "Copy the prepared terms and retry the official Reading Room after CIA restores the service."
      ]
    };
  }
  return {
    queryText,
    queryUrl: source.manualSearchUrl,
    appliedFilters: {},
    status: "prepared",
    warnings: [
      "Open the registered official source and paste the prepared terms.",
      "The query will leave Opstalia and may appear in the official site's logs and browser history."
    ]
  };
}

export function formatManualHandoffForClipboard(
  source: SourceDefinition,
  handoff: ManualSearchHandoff
): string {
  const filters = Object.entries(handoff.appliedFilters)
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");
  return [
    `${source.displayName} — prepared unclassified search`,
    `Search text: ${handoff.queryText || "(none)"}`,
    filters,
    handoff.queryUrl ? `Official handoff: ${handoff.queryUrl}` : ""
  ].filter(Boolean).join("\n");
}
