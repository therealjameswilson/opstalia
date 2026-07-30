import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  JFK_2025_PARSER_VERSION,
  JFK_2025_SOURCE_PAGE,
  parseJfk2025ReleasePage
} from "./jfk-2025-index-utils.mjs";

const OUTPUT = new URL("../public/data/indexes/jfk-2025.json", import.meta.url);
const MAX_SOURCE_BYTES = 2_000_000;
const MINIMUM_RECORDS = 2_000;
const MAXIMUM_RECORDS = 5_000;

async function readBoundedBody(response, maximumBytes) {
  const declaredLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error(`NARA JFK source exceeds the ${maximumBytes}-byte response limit`);
  }
  if (!response.body) throw new Error("NARA JFK source returned no response body");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new Error(`NARA JFK source exceeds the ${maximumBytes}-byte response limit`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

const retrievedAt = new Date().toISOString();
const response = await fetch(JFK_2025_SOURCE_PAGE, {
  headers: {
    Accept: "text/html",
    "User-Agent":
      "Opstalia/1.2 source-index refresh (+https://github.com/therealjameswilson/opstalia/issues)"
  },
  redirect: "error"
});
if (!response.ok) throw new Error(`NARA JFK source returned ${response.status}`);
if (response.url !== JFK_2025_SOURCE_PAGE) {
  throw new Error(`NARA JFK source resolved outside the expected page: ${response.url}`);
}
const contentType = response.headers.get("content-type") ?? "";
if (!/^text\/html(?:;|$)/i.test(contentType)) {
  throw new Error(`Unexpected NARA JFK content type: ${contentType || "(missing)"}`);
}
const sourceBytes = await readBoundedBody(response, MAX_SOURCE_BYTES);
const sourceHtml = sourceBytes.toString("utf8");
const parsed = parseJfk2025ReleasePage(sourceHtml, {
  minimumRecords: MINIMUM_RECORDS,
  maximumRecords: MAXIMUM_RECORDS
});
const output = {
  schemaVersion: 1,
  sourceId: "nara-jfk-2025",
  sourcePage: JFK_2025_SOURCE_PAGE,
  generatedAt: retrievedAt,
  sourceSnapshot: {
    retrievedAt,
    sha256: createHash("sha256").update(sourceBytes).digest("hex"),
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified"),
    contentType,
    byteLength: sourceBytes.byteLength,
    parserVersion: JFK_2025_PARSER_VERSION
  },
  batchSummary: parsed.batchSummary,
  declaredPdfTotal: parsed.declaredPdfTotal,
  rowCount: parsed.records.length,
  distinctRifCount: parsed.distinctRifCount,
  limitations: [
    "This index contains only file-level metadata and official PDF links parsed from the NARA JFK Assassination Records - 2025 Documents Release page. It does not ingest Doctly or any other unofficial copy, OCR, transcript, or repository.",
    "The source page's per-row NARA Release Date currently does not identify the true release batch: every table row reports 03/18/2025 even though the page's batch summary includes later 2025 releases and a January 30, 2026 release. Opstalia preserves that value only as source-reported metadata and does not infer a batch.",
    "A shared base RIF does not establish that files are duplicates. Every distinct official URL and filename variant is retained.",
    "An official file link establishes public availability, not that a copy was released in full, is complete, is unredacted, or is the best available public version.",
    "NARA warns that records in this collection may contain personally identifiable information and that some material may be subject to copyright."
  ],
  records: parsed.records
};
mkdirSync(new URL("../public/data/indexes/", import.meta.url), { recursive: true });
writeFileSync(OUTPUT, `${JSON.stringify(output)}\n`);
process.stdout.write(
  `Wrote ${output.rowCount} official NARA JFK release files across ${output.distinctRifCount} base RIFs.\n`
);
