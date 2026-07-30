export const NDC_HEADERS = [
  "RG",
  "Office",
  "Record Entry Title",
  "Custodial Unit",
  "HMS Record Entry ID#",
  "HMS Entry",
  "Media Type",
  "Online Access"
];

function normalizedHeader(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

export function findNdcHeaderRowIndex(rows) {
  const expected = new Set(NDC_HEADERS.map(normalizedHeader));
  return rows.findIndex((row) => {
    const present = new Set(row.map(normalizedHeader).filter(Boolean));
    return expected.size === present.size && [...expected].every((header) => present.has(header));
  });
}

export function buildNdcRecords(rows, headerRowIndex, { sourceUrl, sourcePage, releaseQuarter }) {
  if (headerRowIndex < 0) throw new Error("NDC worksheet headers were not recognized");
  const headers = rows[headerRowIndex].map((value, index) => String(value ?? "").trim() || `column_${index + 1}`);
  const titleIndex = headers.findIndex((header) => normalizedHeader(header) === "record entry title");
  if (titleIndex < 0) throw new Error("NDC Record Entry Title column was not recognized");
  const records = rows
    .slice(headerRowIndex + 1)
    .filter((row) => row.some((value) => String(value ?? "").trim()))
    .map((row, index) => {
      const fields = Object.fromEntries(headers.map((header, cellIndex) => [header, String(row[cellIndex] ?? "").trim()]));
      const searchableText = Object.values(fields).join(" ");
      return {
        id: `ndc-${releaseQuarter.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "")}-${index + 1}`,
        title: String(row[titleIndex] ?? "").trim() || `NDC ${releaseQuarter} release-list entry ${index + 1}`,
        fields,
        searchableText,
        officialUrl: sourceUrl,
        recordPageUrl: sourcePage,
        releaseStatus: /not available online/i.test(searchableText)
          ? "described_but_not_digitized"
          : "finding_aid_only"
      };
    });
  return { headers, records };
}
