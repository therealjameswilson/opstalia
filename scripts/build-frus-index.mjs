import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const SOURCE_REPOSITORY = "https://github.com/HistoryAtState/frus-unbound.git";
const PINNED_COMMIT = "56d9b6899758c7de95de58b48b20507a1edb9f9f";
const OUTPUT = new URL("../public/data/indexes/frus.json", import.meta.url);

function decodeXml(value = "") {
  return value
    .replace(/<gap\b[^>]*reason="[^"]*"[^>]*\/>/gi, " [editorial omission] ")
    .replace(/<lb\b[^>]*\/>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function first(xml, pattern) {
  return decodeXml(xml.match(pattern)?.[1] ?? "");
}

function all(xml, pattern) {
  return [...xml.matchAll(pattern)].map((match) => decodeXml(match[1])).filter(Boolean);
}

function parseDocument(xml, sourcePath) {
  const volumeId = first(xml, /<bibl\s+type="frus-volume-id">([\s\S]*?)<\/bibl>/i);
  const documentId = first(xml, /<bibl\s+type="frus-document-id">([\s\S]*?)<\/bibl>/i);
  const title = first(xml, /<titleStmt>[\s\S]*?<title>([\s\S]*?)<\/title>/i);
  const volumeTitle = first(xml, /<title\s+type="complete">([\s\S]*?)<\/title>/i);
  const officialUrl =
    xml.match(/<relatedItem\s+type="canonical"\s+target="([^"]+)"/i)?.[1] ??
    `https://history.state.gov/historicaldocuments/${volumeId}/${documentId}`;
  const dateNode = xml.match(/<setting>[\s\S]*?<date\b([^>]*)>([\s\S]*?)<\/date>/i);
  const dateAttributes = dateNode?.[1] ?? "";
  const date =
    dateAttributes.match(/\bwhen="([^"]+)"/i)?.[1] ??
    dateAttributes.match(/\bnotBefore="([^"]+)"/i)?.[1] ??
    decodeXml(dateNode?.[2] ?? "");
  const body = xml.match(/<text>[\s\S]*?<body>([\s\S]*?)<\/body>[\s\S]*?<\/text>/i)?.[1] ?? "";
  const sourceNote = first(body, /<note\b(?=[^>]*\btype="source")[^>]*>([\s\S]*?)<\/note>/i);
  const heading = first(body, /<head\b[^>]*>([\s\S]*?)<\/head>/i);
  const snippet = decodeXml(body).slice(0, 2200);
  return {
    id: `${volumeId}/${documentId}`,
    volumeId,
    documentId,
    documentNumber: first(xml, /<bibl\s+type="frus-document-number">([\s\S]*?)<\/bibl>/i),
    title: title || heading,
    volumeTitle,
    date,
    dateDisplay: decodeXml(dateNode?.[2] ?? ""),
    persons: all(xml, /<persName\b[^>]*>([\s\S]*?)<\/persName>/gi).slice(0, 40),
    repository: first(xml, /<msIdentifier>[\s\S]*?<repository>([\s\S]*?)<\/repository>/i),
    collection: first(xml, /<msIdentifier>[\s\S]*?<collection>([\s\S]*?)<\/collection>/i),
    archivalIdentifier: first(xml, /<msIdentifier>[\s\S]*?<idno>([\s\S]*?)<\/idno>/i),
    documentType: first(xml, /<seg\s+type="document-type">([\s\S]*?)<\/seg>/i),
    authors: all(xml, /<rs\s+type="author"[^>]*>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/rs>/gi),
    recipients: all(xml, /<rs\s+type="recipient"[^>]*>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/rs>/gi),
    sourceNote,
    snippet,
    officialUrl,
    sourcePath
  };
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : path.endsWith(".xml") ? [path] : [];
  });
}

const temporaryDirectory = mkdtempSync(join(tmpdir(), "opstalia-frus-"));
const checkout = join(temporaryDirectory, "frus-unbound");
try {
  execFileSync("git", ["clone", "--quiet", "--depth", "1", SOURCE_REPOSITORY, checkout], { stdio: "inherit" });
  execFileSync("git", ["fetch", "--quiet", "--depth", "1", "origin", PINNED_COMMIT], { cwd: checkout, stdio: "inherit" });
  execFileSync("git", ["checkout", "--quiet", PINNED_COMMIT], { cwd: checkout, stdio: "inherit" });
  const files = walk(join(checkout, "data")).filter((path) => /\/docs\/d\d+\.xml$/i.test(path));
  const records = files
    .map((path) => parseDocument(readFileSync(path, "utf8"), relative(checkout, path)))
    .filter((record) => record.volumeId && record.documentId && record.title && record.officialUrl);
  const output = {
    schemaVersion: 1,
    source: "HistoryAtState/frus-unbound",
    sourceRepository: "https://github.com/HistoryAtState/frus-unbound",
    upstreamRepository: "https://github.com/HistoryAtState/frus",
    commit: PINNED_COMMIT,
    generatedAt: new Date().toISOString(),
    coverage: [...new Set(records.map((record) => record.volumeId))].sort(),
    limitations: [
      "This checked-in 1.0 index covers three official FRUS volumes exposed in the Office of the Historian frus-unbound project, not the entire FRUS series.",
      "Primary evidence links point to history.state.gov; the official GitHub project is build provenance only.",
      "FRUS is an official edited publication and not necessarily a complete facsimile of the underlying archival record."
    ],
    records
  };
  mkdirSync(new URL("../public/data/indexes/", import.meta.url), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(output)}\n`);
  process.stdout.write(`Wrote ${records.length} FRUS records across ${output.coverage.length} volumes.\n`);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
