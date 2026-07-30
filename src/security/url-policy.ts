import type {
  NormalizedRecord,
  ProvenanceRecord,
  SourceDefinition
} from "../core/types";

export function normalizeHostname(hostname: string): string {
  return hostname.toLocaleLowerCase().replace(/\.$/, "");
}

function decodePathComponent(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

export const NARA_JFK_RELEASE_PAGE_URL =
  "https://www.archives.gov/research/jfk/release-2025";

export interface NaraJfkReleasePdfLocator {
  canonicalUrl: string;
  fileName: string;
  rifNumber: string;
}

export function canonicalNaraJfkReleasePdf(
  value: string
): NaraJfkReleasePdfLocator | undefined {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  if (
    parsed.protocol !== "https:" ||
    !["archives.gov", "www.archives.gov"].includes(
      normalizeHostname(parsed.hostname)
    ) ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.search ||
    parsed.hash
  ) {
    return undefined;
  }
  const match = parsed.pathname.match(
    /^\/files\/research\/jfk\/releases\/2025\/0318\/([^/]+)$/i
  );
  const fileName = match ? decodePathComponent(match[1]) : undefined;
  const hasControlCharacter = [...(fileName ?? "")].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
  if (
    !fileName ||
    !/\.pdf$/i.test(fileName) ||
    fileName === "." ||
    fileName === ".." ||
    fileName.includes("/") ||
    fileName.includes("\\") ||
    fileName.includes("%") ||
    hasControlCharacter
  ) {
    return undefined;
  }
  const rifNumber = fileName.match(/^(\d{3}-\d{5}-\d{5})(?:[^/]*)\.pdf$/i)?.[1];
  if (!rifNumber) return undefined;
  parsed.hostname = "www.archives.gov";
  parsed.pathname = parsed.pathname
    .split("/")
    .map((segment) => encodeURIComponent(decodePathComponent(segment) ?? segment))
    .join("/");
  return {
    canonicalUrl: parsed.href,
    fileName,
    rifNumber
  };
}

export function canonicalNtrsDownloadPath(
  path: string,
  citationId: string
): string | undefined {
  if (!/^\d+$/.test(citationId)) return undefined;
  const match = path.match(
    /^\/api\/citations\/(\d+)\/downloads\/([^/?#]+)$/
  );
  if (!match || match[1] !== citationId) return undefined;
  const filename = decodePathComponent(match[2]);
  const hasControlCharacter = [...(filename ?? "")].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
  if (
    !filename ||
    filename === "." ||
    filename === ".." ||
    filename.includes("/") ||
    filename.includes("\\") ||
    filename.includes("%") ||
    hasControlCharacter
  ) {
    return undefined;
  }
  return `/api/citations/${citationId}/downloads/${encodeURIComponent(filename)}`;
}

export function domainMatches(hostname: string, approvedDomain: string): boolean {
  const candidate = normalizeHostname(hostname);
  const approved = normalizeHostname(approvedDomain);
  return candidate === approved || candidate.endsWith(`.${approved}`);
}

export function isApprovedOfficialUrl(url: string, source: SourceDefinition): boolean {
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.port
    ) {
      return false;
    }
    return source.officialDomains.some((domain) => domainMatches(parsed.hostname, domain));
  } catch {
    return false;
  }
}

const PUBLIC_RECORD_FILE = /\.(?:pdf|txt|tif|tiff|jpg|jpeg|png|jp2)$/i;

export function validateResearcherRecordLocator(
  url: string,
  source: SourceDefinition
): { allowed: boolean; reason: string } {
  if (!isApprovedOfficialUrl(url, source)) {
    return {
      allowed: false,
      reason: `Use an HTTPS URL without credentials or a nonstandard port on an approved ${source.displayName} domain.`
    };
  }

  const parsed = new URL(url);
  const path = parsed.pathname;
  if (source.id === "cia") {
    const readingRoomRecord = /^\/readingroom\/document\/[^/]+\/?$/i.test(path);
    const readingRoomFile =
      /^\/readingroom\/(?:docs?|document-files?)\//i.test(path) &&
      PUBLIC_RECORD_FILE.test(path);
    return readingRoomRecord || readingRoomFile
      ? { allowed: true, reason: "Recognized CIA Reading Room record or file locator" }
      : {
          allowed: false,
          reason:
            "Use a CIA Reading Room document page (/readingroom/document/…) or direct Reading Room record file, not a CIA home, search, status, or publications page."
        };
  }

  if (source.id === "state-foia") {
    return /^\/documents\/.+\.pdf$/i.test(path)
      ? { allowed: true, reason: "Recognized State FOIA released-document file locator" }
      : {
          allowed: false,
          reason:
            "Use a direct State released-document PDF under /DOCUMENTS/…, not the search-results page, FOIA homepage, or another navigation page."
        };
  }

  if (source.id === "fbi-vault") {
    const vaultDownload =
      domainMatches(parsed.hostname, "vault.fbi.gov") &&
      /\/at_download\/file\/?$/i.test(path);
    return vaultDownload || PUBLIC_RECORD_FILE.test(path)
      ? { allowed: true, reason: "Recognized FBI Vault record file locator" }
      : {
          allowed: false,
          reason:
            "Use an FBI Vault /at_download/file URL or another direct official record file, not an FBI homepage or search page."
        };
  }

  return PUBLIC_RECORD_FILE.test(path)
    ? { allowed: true, reason: "Direct public record file on an approved official domain" }
    : {
        allowed: false,
        reason:
          "Use a direct official public record file URL. Homepages, search pages, status pages, and general collection pages are research leads, not primary record evidence."
      };
}

export function validatePrimaryEvidence(
  officialUrl: string,
  provenance: ProvenanceRecord | undefined,
  source: SourceDefinition | undefined
): { allowed: boolean; reason: string } {
  if (!source) return { allowed: false, reason: "No registered source adapter" };
  if (!provenance || provenance.adapterId !== source.id) {
    return { allowed: false, reason: "Missing or mismatched adapter provenance" };
  }
  if (provenance.sourceId !== source.id) {
    return { allowed: false, reason: "Mismatched provenance source" };
  }
  if (!isApprovedOfficialUrl(officialUrl, source)) {
    return { allowed: false, reason: "URL is outside the source registry allowlist" };
  }
  if (!provenance.officialRecordUrl) return { allowed: false, reason: "Missing official record or file URL" };
  if (!isApprovedOfficialUrl(provenance.officialRecordUrl, source)) {
    return { allowed: false, reason: "Provenance record URL is outside the source registry allowlist" };
  }
  try {
    const provenanceHost = new URL(provenance.officialRecordUrl).hostname;
    if (!domainMatches(provenanceHost, provenance.officialDomain)) {
      return { allowed: false, reason: "Provenance domain does not match its official record URL" };
    }
  } catch {
    return { allowed: false, reason: "Invalid provenance record URL" };
  }
  return { allowed: true, reason: "Registered adapter, approved official domain, and official URL present" };
}

export function validateNormalizedRecordEvidence(
  record: NormalizedRecord,
  source: SourceDefinition
): { allowed: boolean; reason: string } {
  const primary = validatePrimaryEvidence(
    record.officialUrl?.value ?? "",
    record.provenance,
    source
  );
  if (!primary.allowed) return primary;
  const locators: Array<[string, string | undefined]> = [
    ["record page", record.recordPageUrl?.value],
    ["download", record.downloadUrl?.value],
    ["thumbnail", record.thumbnailUrl?.value]
  ];
  record.digitalObjects.forEach((object, index) => {
    locators.push(
      [`digital object ${index + 1}`, object.url],
      [`digital object ${index + 1} download`, object.downloadUrl],
      [`digital object ${index + 1} thumbnail`, object.thumbnailUrl]
    );
  });
  for (const [label, value] of locators) {
    if (value && !isApprovedOfficialUrl(value, source)) {
      return {
        allowed: false,
        reason: `${label} URL is outside the source registry allowlist`
      };
    }
  }
  const fileLocators = [
    record.downloadUrl?.value,
    ...record.digitalObjects.flatMap((object) => [
      object.url,
      object.downloadUrl
    ])
  ].filter((value): value is string => Boolean(value));
  if (source.id === "nara-jfk-2025") {
    const primaryLocator = canonicalNaraJfkReleasePdf(
      record.officialUrl.value
    );
    const provenanceLocator = canonicalNaraJfkReleasePdf(
      record.provenance.officialRecordUrl
    );
    const recordPage = record.recordPageUrl?.value;
    const recordPageMatches =
      recordPage === NARA_JFK_RELEASE_PAGE_URL ||
      recordPage === NARA_JFK_RELEASE_PAGE_URL.replace(
        "https://www.",
        "https://"
      );
    if (
      !primaryLocator ||
      !provenanceLocator ||
      !recordPageMatches ||
      !record.documentNumber?.value ||
      primaryLocator.rifNumber !== record.documentNumber.value ||
      provenanceLocator.rifNumber !== record.documentNumber.value ||
      provenanceLocator.canonicalUrl !== primaryLocator.canonicalUrl ||
      fileLocators.some(
        (value) => {
          const locator = canonicalNaraJfkReleasePdf(value);
          return (
            !locator ||
            locator.rifNumber !== record.documentNumber?.value ||
            locator.canonicalUrl !== primaryLocator.canonicalUrl
          );
        }
      )
    ) {
      return {
        allowed: false,
        reason:
          "NARA JFK evidence must bind the official release-page PDF path and filename RIF to the normalized document number"
      };
    }
  }
  if (source.id === "nasa-ntrs") {
    const citationId = new URL(record.officialUrl.value).pathname.match(
      /^\/citations\/(\d+)\/?$/
    )?.[1];
    if (
      !citationId ||
      fileLocators.some(
        (value) =>
          !canonicalNtrsDownloadPath(
            new URL(value).pathname,
            citationId
          )
      )
    ) {
      return {
        allowed: false,
        reason: "NASA NTRS file locator is not bound to the official citation ID"
      };
    }
  }
  if (source.id === "osti-sti") {
    const ostiId = new URL(record.officialUrl.value).pathname.match(
      /^\/biblio\/(\d+)\/?$/
    )?.[1];
    if (
      !ostiId ||
      fileLocators.some(
        (value) =>
          new URL(value).pathname.replace(/\/$/, "") !==
          `/servlets/purl/${ostiId}`
      )
    ) {
      return {
        allowed: false,
        reason: "OSTI full-text locator is not bound to the official OSTI ID"
      };
    }
  }
  if (source.id === "govinfo") {
    const parts = new URL(record.officialUrl.value).pathname
      .split("/")
      .filter(Boolean);
    const detailIndex =
      parts[0] === "app" && parts[1] === "details" ? 2 : -1;
    const packageId =
      detailIndex === 2 && parts[detailIndex]
        ? decodePathComponent(parts[detailIndex])
        : undefined;
    const granuleId =
      detailIndex === 2 && parts[detailIndex + 1]
        ? decodePathComponent(parts[detailIndex + 1])
        : packageId;
    const expectedPath =
      packageId && granuleId
        ? `/content/pkg/${encodeURIComponent(packageId)}/pdf/${encodeURIComponent(granuleId)}.pdf`
        : undefined;
    if (
      !expectedPath ||
      fileLocators.some(
        (value) => new URL(value).pathname !== expectedPath
      )
    ) {
      return {
        allowed: false,
        reason: "GovInfo PDF locator is not bound to the official package or granule ID"
      };
    }
  }
  return {
    allowed: true,
    reason: "Every returned record and file locator uses an approved official domain"
  };
}

export function assertSafeOutboundUrl(url: string, allowedHosts: string[]): URL {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !allowedHosts.some((host) => domainMatches(parsed.hostname, host))) {
    throw new Error("Outbound URL rejected by SSRF allowlist");
  }
  if (parsed.username || parsed.password || parsed.port) throw new Error("Outbound URL contains forbidden authority data");
  return parsed;
}
