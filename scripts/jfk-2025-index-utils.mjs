import { createHash } from "node:crypto";

export const JFK_2025_SOURCE_PAGE = "https://www.archives.gov/research/jfk/release-2025";
export const JFK_2025_PARSER_VERSION = "1.0.0";
export const JFK_2025_HEADERS = ["Record Number", "NARA Release Date"];

const PDF_PATH_PREFIX = "/files/research/jfk/releases/";
const RIF_PATTERN = /^\d{3}-\d{5}-\d{5}/;
const RELEASE_DATE_PATTERN = /^(?:0[1-9]|1[0-2])\/(?:0[1-9]|[12]\d|3[01])\/\d{4}$/;
const SAFE_OFFICIAL_HOSTS = new Set(["archives.gov", "www.archives.gov"]);

function decodeEntity(entity) {
  const normalized = entity.toLocaleLowerCase();
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"'
  };
  if (normalized in named) return named[normalized];
  if (/^#x[0-9a-f]+$/i.test(entity)) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
  if (/^#\d+$/.test(entity)) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
  return `&${entity};`;
}

export function decodeHtml(value = "") {
  return String(value)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&([a-z]+|#\d+|#x[0-9a-f]+);/gi, (_, entity) => decodeEntity(entity))
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedHeader(value) {
  return decodeHtml(value).toLocaleLowerCase();
}

function attribute(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(
    new RegExp(`\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i")
  );
  return match ? decodeHtml(match[1] ?? match[2] ?? match[3] ?? "") : "";
}

function safeDecodedPathname(url) {
  if (/%(?:2f|5c|00|0a|0d)/i.test(url.pathname)) {
    throw new Error(`JFK PDF URL contains a prohibited encoded path character: ${url.toString()}`);
  }
  let decoded;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    throw new Error(`JFK PDF URL contains malformed percent encoding: ${url.toString()}`);
  }
  const hasProhibitedCharacter = [...decoded].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f || character === "\\";
  });
  if (hasProhibitedCharacter) {
    throw new Error(`JFK PDF URL contains a prohibited path character: ${url.toString()}`);
  }
  if (decoded.includes("%")) {
    throw new Error(`JFK PDF URL contains unresolved percent encoding: ${url.toString()}`);
  }
  const segments = decoded.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error(`JFK PDF URL contains a traversal segment: ${url.toString()}`);
  }
  return decoded;
}

export function normalizeOfficialJfkPdfUrl(href, sourcePage = JFK_2025_SOURCE_PAGE) {
  const rawHref = String(href);
  if (/(?:^|\/)\.{1,2}(?:\/|$)|%2e|%25(?:2e|2f|5c)/i.test(rawHref)) {
    throw new Error(`JFK PDF link contains a prohibited traversal or nested encoding: ${rawHref}`);
  }
  let page;
  let url;
  try {
    page = new URL(sourcePage);
    url = new URL(rawHref, page);
  } catch {
    throw new Error(`JFK PDF link is not a valid URL: ${String(href)}`);
  }
  if (
    page.toString() !== JFK_2025_SOURCE_PAGE ||
    url.protocol !== "https:" ||
    !SAFE_OFFICIAL_HOSTS.has(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    throw new Error(`JFK PDF link is outside the approved NARA boundary: ${url.toString()}`);
  }
  const decodedPathname = safeDecodedPathname(url);
  if (
    !decodedPathname.startsWith(PDF_PATH_PREFIX) ||
    !/^\/files\/research\/jfk\/releases\/\d{4}\/\d{4}\/[^/]+$/.test(decodedPathname)
  ) {
    throw new Error(`JFK PDF link does not use the official NARA release path: ${url.toString()}`);
  }
  const fileName = decodedPathname.slice(decodedPathname.lastIndexOf("/") + 1);
  if (
    !fileName ||
    fileName.includes("/") ||
    fileName.includes("\\") ||
    !RIF_PATTERN.test(fileName) ||
    !/\.pdf$/i.test(fileName)
  ) {
    throw new Error(`JFK PDF link does not identify a RIF-named PDF: ${url.toString()}`);
  }
  return { officialUrl: url.toString(), fileName };
}

function findReleaseTable(html) {
  for (const match of html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)) {
    const table = match[0];
    const headerRow = table.match(/<thead\b[^>]*>[\s\S]*?<tr\b[^>]*>([\s\S]*?)<\/tr>[\s\S]*?<\/thead>/i);
    if (!headerRow) continue;
    const headers = [...headerRow[1].matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((cell) =>
      normalizedHeader(cell[1])
    );
    if (
      headers.length === JFK_2025_HEADERS.length &&
      headers.every((header, index) => header === normalizedHeader(JFK_2025_HEADERS[index]))
    ) {
      return { table, tableIndex: match.index ?? -1 };
    }
  }
  throw new Error("NARA JFK release table headers were not recognized");
}

function parseBatchSummary(htmlBeforeTable) {
  const lists = [...htmlBeforeTable.matchAll(/<ul\b[^>]*>([\s\S]*?)<\/ul>/gi)];
  const list = lists
    .map((match) => match[1])
    .reverse()
    .find((body) => /\([\d,\s]+(?:&nbsp;|\s)*PDF files?\)/i.test(body));
  if (!list) throw new Error("NARA JFK PDF batch summary was not found");

  const batches = [...list.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((match) => decodeHtml(match[1]))
    .map((label) => {
      const count = label.match(/\(([\d,\s]+)\s+PDF files?\)/i);
      return count
        ? {
            label,
            pdfCount: Number.parseInt(count[1].replace(/[,\s]/g, ""), 10)
          }
        : null;
    })
    .filter((batch) => batch !== null);
  if (!batches.length || batches.some((batch) => !Number.isSafeInteger(batch.pdfCount) || batch.pdfCount < 1)) {
    throw new Error("NARA JFK PDF batch counts were not recognized");
  }
  return batches;
}

function parseReleaseRows(table, sourcePage) {
  const tbody = table.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i)?.[1];
  if (!tbody) throw new Error("NARA JFK release table body was not found");
  const rowMatches = [...tbody.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  if (!rowMatches.length) throw new Error("NARA JFK release table has no rows");

  const records = [];
  const exactUrls = new Set();
  const exactIds = new Set();
  for (const [rowOffset, rowMatch] of rowMatches.entries()) {
    const cells = [...rowMatch[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cell[1]);
    if (cells.length !== 2) {
      throw new Error(`NARA JFK release table row ${rowOffset + 1} does not have exactly two cells`);
    }
    const anchors = [...cells[0].matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)];
    if (anchors.length !== 1) {
      throw new Error(`NARA JFK release table row ${rowOffset + 1} does not have exactly one file link`);
    }
    const anchorTag = anchors[0][0].match(/^<a\b[^>]*>/i)?.[0] ?? "";
    const sourceHref = attribute(anchorTag, "href");
    const label = decodeHtml(anchors[0][0]);
    const releaseDate = decodeHtml(cells[1]);
    const { officialUrl, fileName } = normalizeOfficialJfkPdfUrl(sourceHref, sourcePage);
    if (label !== fileName) {
      throw new Error(
        `NARA JFK release table row ${rowOffset + 1} file label does not match its official URL`
      );
    }
    if (!RELEASE_DATE_PATTERN.test(releaseDate)) {
      throw new Error(`NARA JFK release table row ${rowOffset + 1} has an invalid source-reported date`);
    }
    if (exactUrls.has(officialUrl)) {
      throw new Error(`NARA JFK release table repeats an exact file URL: ${officialUrl}`);
    }
    exactUrls.add(officialUrl);

    const rifNumber = fileName.match(RIF_PATTERN)?.[0];
    if (!rifNumber) throw new Error(`NARA JFK file name does not contain a base RIF: ${fileName}`);
    const fileVariant = fileName.slice(rifNumber.length, -4);
    const urlHash = createHash("sha256").update(officialUrl).digest("hex");
    const id = `nara-jfk-2025-${urlHash.slice(0, 24)}`;
    if (exactIds.has(id)) throw new Error(`NARA JFK stable file ID collision: ${id}`);
    exactIds.add(id);
    const visiblyRedactedVariant = /redacted/i.test(fileVariant);
    records.push({
      id,
      fileName,
      rifNumber,
      fileVariant,
      releaseDate,
      officialUrl,
      sourceHref,
      recordPageUrl: sourcePage,
      rowIndex: rowOffset + 1,
      searchableText: [
        "JFK assassination record",
        fileName,
        rifNumber,
        fileVariant.replace(/[_()]+/g, " "),
        releaseDate
      ]
        .filter(Boolean)
        .join(" "),
      releaseStatus: visiblyRedactedVariant
        ? "released_with_redactions_status_unclear"
        : "not_determined",
      releaseDeterminationBasis: visiblyRedactedVariant
        ? 'The NARA-supplied filename includes "redacted"; the redaction extent and release completeness require human review.'
        : "The official NARA file link establishes public availability, but the release table does not establish that this copy is complete or unredacted."
    });
  }
  return records;
}

export function parseJfk2025ReleasePage(
  html,
  {
    sourcePage = JFK_2025_SOURCE_PAGE,
    minimumRecords = 1,
    maximumRecords = 5_000
  } = {}
) {
  if (typeof html !== "string" || !html.trim()) throw new Error("NARA JFK source HTML is empty");
  const { table, tableIndex } = findReleaseTable(html);
  const batchSummary = parseBatchSummary(html.slice(0, tableIndex));
  const records = parseReleaseRows(table, sourcePage);
  if (records.length < minimumRecords || records.length > maximumRecords) {
    throw new Error(
      `NARA JFK release table row count ${records.length} is outside the allowed range ${minimumRecords}-${maximumRecords}`
    );
  }
  const declaredPdfTotal = batchSummary.reduce((total, batch) => total + batch.pdfCount, 0);
  if (declaredPdfTotal !== records.length) {
    throw new Error(
      `NARA JFK batch summary declares ${declaredPdfTotal} PDFs but the release table contains ${records.length} rows`
    );
  }
  return {
    batchSummary,
    declaredPdfTotal,
    distinctRifCount: new Set(records.map((record) => record.rifNumber)).size,
    records
  };
}
