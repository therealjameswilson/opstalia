import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildNdcRecords, findNdcHeaderRowIndex } from "./ndc-index-utils.mjs";

const SOURCE_PAGE = "https://www.archives.gov/declassification/ndc-2";
const SOURCE_URL = "https://www.archives.gov/files/3rd-quarter-release-list-fy-26-.xlsx";
const OUTPUT = new URL("../public/data/indexes/ndc.json", import.meta.url);
const MAX_BYTES = 10_000_000;

function decodeXml(value = "") {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .trim();
}

function columnIndex(reference) {
  const letters = reference.replace(/\d+/g, "");
  return [...letters].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

const response = await fetch(SOURCE_URL, { headers: { "User-Agent": "Opstalia source-index refresh contact: repository issues" } });
if (!response.ok) throw new Error(`NDC source returned ${response.status}`);
const contentType = response.headers.get("content-type") ?? "";
if (!/spreadsheet|excel|octet-stream|zip/i.test(contentType)) throw new Error(`Unexpected NDC content type: ${contentType}`);
const bytes = Buffer.from(await response.arrayBuffer());
if (bytes.length > MAX_BYTES || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error("NDC workbook failed size or ZIP signature validation");

const temporaryDirectory = mkdtempSync(join(tmpdir(), "opstalia-ndc-"));
const workbook = join(temporaryDirectory, "release-list.xlsx");
writeFileSync(workbook, bytes);
try {
  const sharedStringsXml = execFileSync("unzip", ["-p", workbook, "xl/sharedStrings.xml"], { encoding: "utf8" });
  const worksheetXml = execFileSync("unzip", ["-p", workbook, "xl/worksheets/sheet1.xml"], { encoding: "utf8" });
  const sharedStrings = [...sharedStringsXml.matchAll(/<si>([\s\S]*?)<\/si>/gi)].map((match) =>
    decodeXml([...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((part) => part[1]).join(""))
  );
  const rows = [...worksheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)].map((row) => {
    const values = [];
    for (const cell of row[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)) {
      const reference = cell[1].match(/\br="([^"]+)"/i)?.[1] ?? "A1";
      const type = cell[1].match(/\bt="([^"]+)"/i)?.[1];
      const raw = cell[2].match(/<v>([\s\S]*?)<\/v>/i)?.[1] ?? cell[2].match(/<t\b[^>]*>([\s\S]*?)<\/t>/i)?.[1] ?? "";
      values[columnIndex(reference)] = type === "s" ? sharedStrings[Number(raw)] ?? "" : decodeXml(raw);
    }
    return values;
  });
  const headerRowIndex = findNdcHeaderRowIndex(rows);
  const { headers, records } = buildNdcRecords(rows, headerRowIndex, {
    sourceUrl: SOURCE_URL,
    sourcePage: SOURCE_PAGE,
    releaseQuarter: "FY2026 Q3"
  });
  if (records.length < 50) throw new Error(`Unexpectedly small NDC index: ${records.length}`);
  const output = {
    schemaVersion: 2,
    sourcePage: SOURCE_PAGE,
    sourceUrl: SOURCE_URL,
    releaseQuarter: "FY2026 Q3",
    generatedAt: new Date().toISOString(),
    sourceSha256: createHash("sha256").update(bytes).digest("hex"),
    headers,
    limitations: [
      "Entries describe records that completed NDC declassification processing; other access restrictions or FOIA screening may remain.",
      "A release-list entry is finding-aid or series-level evidence and is never automatically classified as released in full."
    ],
    records
  };
  mkdirSync(new URL("../public/data/indexes/", import.meta.url), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(output)}\n`);
  process.stdout.write(`Wrote ${records.length} NDC release-list entries.\n`);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
