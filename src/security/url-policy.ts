import type { ProvenanceRecord, SourceDefinition } from "../core/types";

export function normalizeHostname(hostname: string): string {
  return hostname.toLocaleLowerCase().replace(/\.$/, "");
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

export function assertSafeOutboundUrl(url: string, allowedHosts: string[]): URL {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !allowedHosts.some((host) => domainMatches(parsed.hostname, host))) {
    throw new Error("Outbound URL rejected by SSRF allowlist");
  }
  if (parsed.username || parsed.password || parsed.port) throw new Error("Outbound URL contains forbidden authority data");
  return parsed;
}
