import { describe, expect, it } from "vitest";
import ndcIndex from "../../public/data/indexes/ndc.json";
import {
  NDC_HEADERS,
  buildNdcRecords,
  findNdcHeaderRowIndex
} from "../../scripts/ndc-index-utils.mjs";

describe("NDC release-list index", () => {
  it("selects the actual workbook header rather than a data row mentioning a series", () => {
    const rows = [
      ["NDC 3rd Quarter FY 2026 Release List"],
      [],
      [...NDC_HEADERS],
      ["19", "Bureau of Ships", "Bulky Enclosures To Secret General Correspondence", "Textual Archives", "HS1-1", "P 1", "Textual", "Not Available Online"],
      ["59", "Department of State", "Files for a series of conferences", "Textual Archives", "HS1-2", "P 2", "Textual", "Not Available Online"]
    ];
    const headerRowIndex = findNdcHeaderRowIndex(rows);
    expect(headerRowIndex).toBe(2);
    const { headers, records } = buildNdcRecords(rows, headerRowIndex, {
      sourceUrl: "https://www.archives.gov/files/example.xlsx",
      sourcePage: "https://www.archives.gov/declassification/ndc-2",
      releaseQuarter: "FY2026 Q3"
    });
    expect(headers).toEqual(NDC_HEADERS);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      title: "Bulky Enclosures To Secret General Correspondence",
      fields: { RG: "19", Office: "Bureau of Ships" }
    });
  });

  it("ships canonical structured headers and retains the workbook's first data row", () => {
    expect(ndcIndex.schemaVersion).toBe(2);
    expect(ndcIndex.headers).toEqual(NDC_HEADERS);
    expect(ndcIndex.records[0]).toMatchObject({
      title: "Bulky Enclosures To Secret General Correspondence",
      fields: { RG: "19", Office: "Bureau of Ships" }
    });
  });
});
