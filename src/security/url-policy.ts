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
    if (parsed.protocol !== "https:") return false;
    return source.officialDomains.some((domain) => domainMatches(parsed.hostname, domain));
  } catch {
    return false;
  }
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
