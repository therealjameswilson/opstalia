// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  JFK_2025_SOURCE_PAGE,
  normalizeOfficialJfkPdfUrl,
  parseJfk2025ReleasePage
} from "../../scripts/jfk-2025-index-utils.mjs";

const jfkIndex = JSON.parse(
  readFileSync(new URL("../../public/data/indexes/jfk-2025.json", import.meta.url), "utf8")
) as {
  schemaVersion: number;
  sourceId: string;
  sourcePage: string;
  declaredPdfTotal: number;
  rowCount: number;
  distinctRifCount: number;
  sourceSnapshot: { parserVersion: string };
  limitations: string[];
  records: Array<{ officialUrl: string }>;
};

function page(rows: string, counts = "2") {
  return `
    <html><body>
      <ul><li>March 18, 2025 Release: 10 pages (${counts} PDF files)</li></ul>
      <table class="an-untrusted-class-name">
        <thead><tr><th>Record&nbsp;Number</th><th>NARA Release Date</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </body></html>
  `;
}

const normalRow = `
  <tr>
    <td><a href="/files/research/jfk/releases/2025/0318/104-10003-10041.PDF">104-10003-10041.PDF</a></td>
    <td>03/18/2025</td>
  </tr>
`;
const variantRow = `
  <tr>
    <td><a href='/files/research/jfk/releases/2025/0318/124-10273-10289_redacted_part_1_of_3.pdf'>124-10273-10289_redacted_part_1_of_3.pdf</a></td>
    <td>03/18/2025</td>
  </tr>
`;

describe("official NARA JFK release-page index", () => {
  it("parses by semantic headers, retains filename variants, and never deduplicates by base RIF", () => {
    const duplicateRifVariant = `
      <tr>
        <td><a href="/files/research/jfk/releases/2025/0318/104-10003-10041%20(DocID%2032989663).pdf">104-10003-10041 (DocID 32989663).pdf</a></td>
        <td>03/18/2025</td>
      </tr>
    `;
    const parsed = parseJfk2025ReleasePage(page(normalRow + duplicateRifVariant), {
      minimumRecords: 2,
      maximumRecords: 2
    });
    expect(parsed).toMatchObject({
      declaredPdfTotal: 2,
      distinctRifCount: 1
    });
    expect(parsed.records).toHaveLength(2);
    expect(parsed.records[0]).toMatchObject({
      fileName: "104-10003-10041.PDF",
      rifNumber: "104-10003-10041",
      fileVariant: "",
      sourceReportedRowDate: "03/18/2025",
      releaseStatus: "not_determined"
    });
    expect(parsed.records[1]).toMatchObject({
      fileName: "104-10003-10041 (DocID 32989663).pdf",
      rifNumber: "104-10003-10041",
      fileVariant: " (DocID 32989663)",
      releaseStatus: "not_determined"
    });
    expect(parsed.records[0].id).not.toBe(parsed.records[1].id);
  });

  it("does not infer release status from a filename that says redacted", () => {
    const parsed = parseJfk2025ReleasePage(page(normalRow + variantRow), {
      minimumRecords: 2,
      maximumRecords: 2
    });
    expect(parsed.records[1]).toMatchObject({
      fileVariant: "_redacted_part_1_of_3",
      releaseStatus: "not_determined",
      releaseDeterminationBasis: expect.stringContaining(
        "filename do not establish"
      )
    });
  });

  it("fails closed when the batch total and table row count disagree", () => {
    expect(() => parseJfk2025ReleasePage(page(normalRow, "2"))).toThrow(
      "declares 2 PDFs but the release table contains 1 rows"
    );
  });

  it("rejects an exact duplicate official URL even when the base RIF is valid", () => {
    expect(() => parseJfk2025ReleasePage(page(normalRow + normalRow))).toThrow(
      "repeats an exact file URL"
    );
  });

  it.each([
    "https://github.com/doctly/jfk/raw/main/104-10003-10041.pdf",
    "https://www.archives.gov/research/jfk/release-2025",
    "https://www.archives.gov/files/research/jfk/releases/2025/0318/not-a-rif.pdf",
    "https://www.archives.gov/files/research/jfk/releases/2025/not-a-batch/104-10003-10041.pdf",
    "https://www.archives.gov/files/research/jfk/releases/2025/0320/104-10003-10041.pdf",
    "https://www.archives.gov/files/research/jfk/releases/2026/0130/104-10003-10041.pdf",
    "https://www.archives.gov/files/research/jfk/releases/2025/0318/104-10003-10041.pdf?download=1",
    "https://www.archives.gov/files/research/jfk/releases/2025/0318/104-10003-10041%2fextra.pdf",
    "https://www.archives.gov/files/research/jfk/releases/2025/0318/104-10003-10041%2520copy.pdf",
    "https://www.archives.gov/files/research/jfk/releases/2025/0318/%252e%252e%252f104-10003-10041.pdf",
    "https://www.archives.gov/files/research/jfk/releases/2025/0318/104-10003-10041.pdf#fragment"
  ])("rejects noncanonical or unofficial evidence URL %s", (url) => {
    expect(() => normalizeOfficialJfkPdfUrl(url)).toThrow();
  });

  it("rejects a label that does not match the official URL filename", () => {
    const mismatched = normalRow.replace(
      ">104-10003-10041.PDF</a>",
      ">104-10003-99999.PDF</a>"
    );
    expect(() => parseJfk2025ReleasePage(page(mismatched, "1"))).toThrow(
      "file label does not match"
    );
  });

  it("ships a guarded official-source snapshot with all declared rows", () => {
    expect(jfkIndex).toMatchObject({
      schemaVersion: 1,
      sourceId: "nara-jfk-2025",
      sourcePage: JFK_2025_SOURCE_PAGE,
      declaredPdfTotal: 2709,
      rowCount: 2709,
      distinctRifCount: 2688,
      sourceSnapshot: {
        parserVersion: "1.0.0"
      }
    });
    expect(jfkIndex.records).toHaveLength(jfkIndex.declaredPdfTotal);
    expect(jfkIndex.records.every((record) => record.officialUrl.startsWith("https://www.archives.gov/files/research/jfk/releases/"))).toBe(true);
    expect(jfkIndex.limitations.join(" ")).toContain("does not ingest Doctly");
    expect(jfkIndex.limitations.join(" ")).toContain("does not identify the true release batch");
  });
});
