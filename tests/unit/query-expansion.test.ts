import { describe, expect, it } from "vitest";
import { buildSearchPlan } from "../../src/search/query-expansion";

describe("deterministic query expansion", () => {
  it("builds editable variants without using notes or an AI provider", () => {
    const plan = buildSearchPlan({
      mode: "guided",
      titleOrSubject: "Memorandum from Scowcroft to Bush",
      exactPhrase: "Malta Summit",
      generalKeywords: "Malta December 1989",
      authorSender: "Brent Scowcroft",
      recipient: "George Bush",
      originatingAgency: "NSC",
      dateFrom: "1989-11-01",
      dateTo: "1990-01-31",
      notes: "private research note that must not become a query"
    });
    expect(plan.queries.some((query) => query.kind === "exact_phrase" && query.text === '"Malta Summit"')).toBe(true);
    expect(plan.queries.some((query) => query.kind === "name_variant" && /Scowcroft/.test(query.text))).toBe(true);
    expect(plan.queries.some((query) => query.kind === "acronym_expansion" && /National Security Council/.test(query.text))).toBe(true);
    expect(plan.queries.some((query) => query.kind === "date_variant")).toBe(true);
    expect(plan.queries.some((query) => query.text.includes("private research note"))).toBe(false);
    expect(plan.queries.every((query) => query.enabled)).toBe(true);
  });

  it("creates an exact NAID identifier query", () => {
    const plan = buildSearchPlan({ mode: "quick", quickQuery: "NAID 1634221" });
    expect(plan.queries).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "identifier", text: "1634221" })]));
  });
});
