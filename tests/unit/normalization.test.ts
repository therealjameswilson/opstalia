import { describe, expect, it } from "vitest";
import { normalizeDate } from "../../src/analysis/date";
import { extractIdentifiers } from "../../src/analysis/identifiers";
import { detectReleaseMarkings } from "../../src/analysis/redactions";
import { exemptionCodes } from "../../src/data/registry";

describe("normalization and release-marking parsing", () => {
  it.each([
    ["1989-12-03", "1989-12-03", "day"],
    ["December 3, 1989", "1989-12-03", "day"],
    ["December 1989", "1989-12", "month"],
    ["1989", "1989", "year"],
    ["1989-1990", "1989/1990", "range"]
  ])("normalizes %s", (input, iso, precision) => {
    expect(normalizeDate(input)).toMatchObject({ iso, precision });
  });

  it("extracts official identifiers without inventing them", () => {
    expect(extractIdentifiers("NAID 1634221; ISCAP 2015-098; CIA-RDP95-00972R000100210014-3; RIF 104-10003-10041")).toEqual(
      expect.arrayContaining(["1634221", "2015-098", "CIA-RDP95-00972R000100210014-3", "104-10003-10041"])
    );
  });

  it("maps visible exemption aliases to the versioned dictionary", () => {
    const markings = detectReleaseMarkings("Declassified in Part under (b)(6) and b7E. Sanitized Copy.", exemptionCodes, 2);
    expect(markings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "b6", page: 2 }),
      expect.objectContaining({ code: "b7E", page: 2 })
    ]));
    expect(markings.some((marking) => /Sanitized/i.test(marking.text))).toBe(true);
  });
});
