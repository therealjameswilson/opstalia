import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

const SOURCE_URL = "https://www.archives.gov/declassification/iscap/releases";
const OUTPUT = new URL("../public/data/indexes/iscap.json", import.meta.url);

function decodeHtml(value = "") {
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

const response = await fetch(SOURCE_URL, { headers: { "User-Agent": "Opstalia source-index refresh contact: repository issues" } });
if (!response.ok) throw new Error(`ISCAP source returned ${response.status}`);
const html = await response.text();
if (!/<table\b/i.test(html) || !/Appeal (?:Number|No\.)/i.test(html)) {
  throw new Error("ISCAP table headers were not recognized");
}
const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].slice(1);
const records = [];
for (const [rowIndex, rowMatch] of rows.entries()) {
  const cells = [...rowMatch[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
  if (cells.length < 6) continue;
  const links = [...cells[0].matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].map((match) => ({
    url: new URL(match[1], SOURCE_URL).toString(),
    title: decodeHtml(match[2])
  }));
  const [titleCell, documentDateCell, agencyCell, locationCell, appealCell, releaseDateCell] = cells;
  const baseTitle = decodeHtml(titleCell);
  const appealNumber = decodeHtml(appealCell);
  if (!baseTitle || !appealNumber) continue;
  const objects = links.length ? links : [{ url: SOURCE_URL, title: baseTitle }];
  for (const [objectIndex, object] of objects.entries()) {
    records.push({
      id: `iscap-${appealNumber}-${objectIndex + 1}`.replace(/[^a-z0-9-]+/gi, "-").toLowerCase(),
      title: object.title || baseTitle,
      groupTitle: baseTitle,
      documentDate: decodeHtml(documentDateCell),
      agency: decodeHtml(agencyCell),
      archivalLocation: decodeHtml(locationCell),
      appealNumber,
      releaseDate: decodeHtml(releaseDateCell),
      officialUrl: object.url,
      recordPageUrl: SOURCE_URL,
      rowIndex: rowIndex + 1,
      notificationOnly: /affirm|notification/i.test(`${object.title} ${object.url}`)
    });
  }
}
if (records.length < 25) throw new Error(`Unexpectedly small ISCAP index: ${records.length}`);
const output = {
  schemaVersion: 1,
  sourceUrl: SOURCE_URL,
  generatedAt: new Date().toISOString(),
  sourceSha256: createHash("sha256").update(html).digest("hex"),
  limitations: [
    "The release table is an official index, not an assertion that each posted copy was released in full.",
    "Affirmed decisions may provide only a notification and no released document."
  ],
  records
};
mkdirSync(new URL("../public/data/indexes/", import.meta.url), { recursive: true });
writeFileSync(OUTPUT, `${JSON.stringify(output)}\n`);
process.stdout.write(`Wrote ${records.length} ISCAP release objects.\n`);
