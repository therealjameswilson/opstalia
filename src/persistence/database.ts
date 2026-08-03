import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { NormalizedRecord, PdfPacketProject, SearchProject } from "../core/types";
import { pdfPacketProjectSchema, projectImportSchema } from "../core/validation";
import { getSource } from "../data/registry";
import {
  isApprovedOfficialUrl,
  validateNormalizedRecordEvidence,
  validateNaraPresidentialLibraryPacket,
  validatePrimaryEvidence,
  validateResearcherRecordLocator
} from "../security/url-policy";
import { buildManualSearchHandoff } from "../search/manual-handoff";

interface OpstaliaDatabase extends DBSchema {
  projects: {
    key: string;
    value: SearchProject;
    indexes: { "by-updated": string };
  };
  preferences: {
    key: string;
    value: { key: string; value: unknown };
  };
  pdfPackets: {
    key: string;
    value: PdfPacketProject;
    indexes: { "by-updated": string };
  };
}

const DATABASE_NAME = "opstalia-v1-research";
const LEGACY_DEMO_PURGE_MARKER = "legacy-auto-loaded-demo-projects-cleared-v1";
const NARA_API_SOURCE_IDS = new Set([
  "nara",
  "nara-cia-rg263",
  "nara-state-rg59"
]);
const NARA_PROFILE_SOURCE_IDS = new Set([
  "nara-cia-rg263",
  "nara-state-rg59"
]);
let databasePromise: Promise<IDBPDatabase<OpstaliaDatabase>> | undefined;

function db(): Promise<IDBPDatabase<OpstaliaDatabase>> {
  databasePromise ??= openDB<OpstaliaDatabase>(DATABASE_NAME, 2, {
    upgrade(database) {
      if (!database.objectStoreNames.contains("projects")) {
        const projects = database.createObjectStore("projects", { keyPath: "id" });
        projects.createIndex("by-updated", "updatedAt");
      }
      if (!database.objectStoreNames.contains("preferences")) {
        database.createObjectStore("preferences", { keyPath: "key" });
      }
      if (!database.objectStoreNames.contains("pdfPackets")) {
        const packets = database.createObjectStore("pdfPackets", { keyPath: "id" });
        packets.createIndex("by-updated", "updatedAt");
      }
    }
  });
  return databasePromise;
}

function generatedLocator(record: NormalizedRecord): NormalizedRecord {
  const naid = record.naraNaid?.value;
  const officialUrl = record.officialUrl.value;
  const title = naid ? `NARA Catalog record ${naid}` : "Saved NARA Catalog locator";
  return {
    id: record.id,
    title: {
      value: title,
      source: "Opstalia saved locator",
      extractionMethod: "researcher_confirmed",
      confidence: 1
    },
    sourceRepository: {
      value: "National Archives Catalog",
      source: "Opstalia source registry",
      extractionMethod: "source_reported",
      confidence: 1
    },
    officialUrl: {
      value: officialUrl,
      source: "Opstalia saved locator",
      extractionMethod: "researcher_confirmed",
      confidence: 1
    },
    recordPageUrl: {
      value: officialUrl,
      source: "Opstalia saved locator",
      extractionMethod: "researcher_confirmed",
      confidence: 1
    },
    naraNaid: naid
      ? { value: naid, source: "Opstalia saved locator", extractionMethod: "researcher_confirmed", confidence: 1 }
      : undefined,
    releaseStatus: {
      status: "not_determined",
      determinationBasis: "Saved locator only; live NARA metadata must be rehydrated",
      source: "Opstalia data-minimization policy",
      confidence: 1,
      humanReview: true
    },
    exemptionCodes: [],
    classificationMarkings: [],
    extractedIdentifiers: naid ? [naid] : [],
    digitalObjects: [],
    provenance: {
      ...record.provenance,
      rawRecordId: undefined,
      normalizationVersion:
        record.provenance.sourceId === "nara"
          ? "1.0.0-locator-only"
          : "1.0.0-nara-catalog-profile-locator-only"
    },
    retrievalTimestamp: record.retrievalTimestamp,
    confidenceScore: 0,
    matchExplanation: [],
    review: record.review
  };
}

function isTransientNaraApiRecord(record: NormalizedRecord): boolean {
  if (record.provenance.sourceId === "nara") return true;
  if (!NARA_PROFILE_SOURCE_IDS.has(record.provenance.sourceId)) return false;
  try {
    return (
      record.provenance.officialDomain.toLocaleLowerCase() === "catalog.archives.gov" &&
      new URL(record.officialUrl.value).hostname.toLocaleLowerCase() === "catalog.archives.gov" &&
      Boolean(record.naraNaid?.value)
    );
  } catch {
    return false;
  }
}

export function sanitizeProjectForPersistence(project: SearchProject): SearchProject {
  const naraRecordIds = new Set(
    project.records
      .filter(isTransientNaraApiRecord)
      .map((record) => record.id)
  );
  return {
    ...project,
    rawRecords: project.rawRecords.filter((record) => !NARA_API_SOURCE_IDS.has(record.sourceId)),
    records: project.records.map((record) => (isTransientNaraApiRecord(record) ? generatedLocator(record) : record)),
    versionGroups: project.versionGroups.map((group) => {
      const containsNara = group.recordIds.some((recordId) => naraRecordIds.has(recordId));
      if (!containsNara) return group;
      let removedAutomaticEvidence = false;
      const relationships = group.relationships.map((relationship) => {
        const includesNara =
          naraRecordIds.has(relationship.leftRecordId) ||
          naraRecordIds.has(relationship.rightRecordId);
        if (!includesNara) return relationship;
        if (!relationship.researcherOverride) removedAutomaticEvidence = true;
        return {
          ...relationship,
          label: relationship.researcherOverride?.label ?? "insufficient_evidence",
          score: 0,
          reasons: [
            relationship.researcherOverride
              ? "Researcher decision retained; live NARA-derived comparison evidence was removed."
              : "Live NARA-derived comparison evidence was not persisted; rerun the NARA search."
          ]
        };
      });
      return {
        ...group,
        label: "Version group containing a saved NARA locator",
        relationships,
        reviewStatus: removedAutomaticEvidence ? "awaiting_review" : group.reviewStatus
      };
    })
  };
}

export async function saveProject(project: SearchProject): Promise<void> {
  if (project.privateMode) return;
  const database = await db();
  await database.put("projects", sanitizeProjectForPersistence(project));
}

export async function listProjects(): Promise<SearchProject[]> {
  const database = await db();
  return (await database.getAllFromIndex("projects", "by-updated")).reverse();
}

/**
 * Removes only checked-in demonstration fixtures that an earlier public build
 * could persist after researcher interaction. The marker makes this a one-time
 * migration, so a researcher may explicitly install the demos again later.
 */
export async function purgeLegacyAutoLoadedDemoProjects(): Promise<number> {
  const database = await db();
  if (await database.get("preferences", LEGACY_DEMO_PURGE_MARKER)) return 0;

  const fixtureIds = (await database.getAll("projects"))
    .filter((project) => project.fixture === true)
    .map((project) => project.id);
  const transaction = database.transaction(["projects", "preferences"], "readwrite");
  const projects = transaction.objectStore("projects");
  const preferences = transaction.objectStore("preferences");
  await Promise.all([
    ...fixtureIds.map((id) => projects.delete(id)),
    preferences.put({ key: LEGACY_DEMO_PURGE_MARKER, value: new Date().toISOString() })
  ]);
  await transaction.done;
  return fixtureIds.length;
}

export async function getProject(id: string): Promise<SearchProject | undefined> {
  const database = await db();
  return database.get("projects", id);
}

export async function deleteProject(id: string): Promise<void> {
  const database = await db();
  await database.delete("projects", id);
}

export async function clearAllLocalData(): Promise<void> {
  const database = await db();
  const transaction = database.transaction(["projects", "preferences", "pdfPackets"], "readwrite");
  await Promise.all([
    transaction.objectStore("projects").clear(),
    transaction.objectStore("preferences").clear(),
    transaction.objectStore("pdfPackets").clear()
  ]);
  await transaction.done;
}

function validatePacketProject(value: unknown): PdfPacketProject {
  const project = pdfPacketProjectSchema.parse(value) as PdfPacketProject;
  const source = getSource(project.source.sourceId);
  if (!source || !project.source.officialRecordUrl || !project.source.naraNaid) {
    throw new Error("Packet project is not tied to a registered NARA presidential-library record");
  }
  const admission = validateNaraPresidentialLibraryPacket(
    {
      officialPdfUrl: project.source.officialPdfUrl,
      officialRecordUrl: project.source.officialRecordUrl,
      naraNaid: project.source.naraNaid
    },
    source
  );
  if (!admission.allowed) throw new Error(`Packet project was rejected: ${admission.reason}`);
  return project;
}

export async function savePdfPacketProject(project: PdfPacketProject): Promise<void> {
  if (project.privateMode) return;
  const database = await db();
  await database.put("pdfPackets", validatePacketProject(project));
}

export async function listPdfPacketProjects(): Promise<PdfPacketProject[]> {
  const database = await db();
  const stored = (await database.getAllFromIndex("pdfPackets", "by-updated")).reverse();
  return stored.flatMap((project) => {
    try {
      return [validatePacketProject(project)];
    } catch {
      return [];
    }
  });
}

export async function deletePdfPacketProject(id: string): Promise<void> {
  const database = await db();
  await database.delete("pdfPackets", id);
}

export function parseImportedPdfPacketProject(text: string): PdfPacketProject {
  if (new TextEncoder().encode(text).byteLength > 5_000_000) {
    throw new Error("Packet-project file exceeds the 5 MB manifest limit");
  }
  const imported = validatePacketProject(JSON.parse(text) as unknown);
  return {
    ...imported,
    id: crypto.randomUUID(),
    name: `${imported.name} (imported)`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: { ...imported.source, sha256: imported.source.sha256?.toLocaleLowerCase() }
  };
}

export async function setPreference(key: string, value: unknown): Promise<void> {
  const database = await db();
  await database.put("preferences", { key, value });
}

export async function getPreference<T>(key: string): Promise<T | undefined> {
  const database = await db();
  return (await database.get("preferences", key))?.value as T | undefined;
}

export function parseImportedProject(text: string): SearchProject {
  if (new TextEncoder().encode(text).byteLength > 20_000_000) {
    throw new Error("Project file exceeds the 20 MB import limit");
  }
  const value = JSON.parse(text) as unknown;
  const parsedProject = projectImportSchema.parse(value) as SearchProject;
  const targetKeys: Array<keyof SearchProject["target"]> = [
    "mode",
    "quickQuery",
    "titleOrSubject",
    "exactPhrase",
    "generalKeywords",
    "dateFrom",
    "dateTo",
    "originatingAgency",
    "originatingOffice",
    "authorSender",
    "recipient",
    "documentType",
    "identifiers",
    "geographicFocus",
    "notes"
  ];
  if (targetKeys.some((key) => parsedProject.target[key] !== parsedProject.plan.target[key])) {
    throw new Error("Imported project target does not match its search-plan target");
  }
  const project: SearchProject = {
    ...parsedProject,
    fixture: false,
    records: parsedProject.records.map((record) => ({
      ...record,
      provenance: {
        ...record.provenance,
        fixture: false,
        importedUnverified: true
      }
    }))
  };
  const recordIds = new Set(project.records.map((record) => record.id));
  for (const run of project.sourceRuns) {
    const source = getSource(run.sourceId);
    const handoffUrl = run.manualHandoff?.queryUrl;
    if (
      !source ||
      (run.manualHandoff && source.searchCapability !== "manual") ||
      (run.manualSearchUrl && !isApprovedOfficialUrl(run.manualSearchUrl, source)) ||
      (handoffUrl && !isApprovedOfficialUrl(handoffUrl, source))
    ) {
      throw new Error(`Imported source run ${run.id} is not tied to a registered official source`);
    }
  }
  if (project.rawRecords.some((record) => !getSource(record.sourceId))) {
    throw new Error("Imported project contains raw data without a registered source");
  }
  for (const query of project.plan.queries) {
    if (query.sourceIds.some((sourceId) => !getSource(sourceId))) {
      throw new Error(`Imported query ${query.id} targets an unregistered source`);
    }
  }
  for (const record of project.records) {
    const source = getSource(record.provenance.sourceId);
    const primary = validatePrimaryEvidence(record.officialUrl.value, record.provenance, source);
    if (!primary.allowed || !source) {
      throw new Error(`Imported record ${record.id} was rejected: ${primary.reason}`);
    }
    const completeEvidence = validateNormalizedRecordEvidence(record, source);
    if (!completeEvidence.allowed) {
      throw new Error(
        `Imported record ${record.id} was rejected: ${completeEvidence.reason}`
      );
    }
    const effectiveOfficialUrl =
      record.officialUrl.researcherOverride?.value ?? record.officialUrl.value;
    if (!isApprovedOfficialUrl(effectiveOfficialUrl, source)) {
      throw new Error(
        `Imported record ${record.id} contains an official-URL override outside its registered official-domain allowlist`
      );
    }
    if (source.searchCapability === "manual") {
      const locator = validateResearcherRecordLocator(effectiveOfficialUrl, source);
      if (!locator.allowed) {
        throw new Error(`Imported researcher locator ${record.id} was rejected: ${locator.reason}`);
      }
    }
    const officialUrls = [
      record.recordPageUrl.value,
      record.recordPageUrl.researcherOverride?.value,
      record.downloadUrl?.value,
      record.downloadUrl?.researcherOverride?.value,
      record.thumbnailUrl?.value,
      record.thumbnailUrl?.researcherOverride?.value,
      ...record.digitalObjects.flatMap((object) => [object.url, object.downloadUrl, object.thumbnailUrl])
    ].filter((url): url is string => Boolean(url));
    if (officialUrls.some((url) => !isApprovedOfficialUrl(url, source))) {
      throw new Error(`Imported record ${record.id} contains a URL outside its registered official-domain allowlist`);
    }
  }
  if (project.savedRecordIds.some((recordId) => !recordIds.has(recordId))) {
    throw new Error("Imported project contains a saved-record reference that does not exist");
  }
  for (const group of project.versionGroups) {
    if (group.recordIds.some((recordId) => !recordIds.has(recordId))) {
      throw new Error(`Imported version group ${group.id} references a record that does not exist`);
    }
  }
  for (const comparison of project.comparisons) {
    if (comparison.recordIds.some((recordId) => !recordIds.has(recordId))) {
      throw new Error(`Imported comparison ${comparison.id} references a record that does not exist`);
    }
  }
  const sourceRecordCounts = new Map<string, number>();
  for (const record of project.records) {
    const sourceId = record.provenance.sourceId;
    sourceRecordCounts.set(sourceId, (sourceRecordCounts.get(sourceId) ?? 0) + 1);
  }
  return {
    ...project,
    sourceRuns: project.sourceRuns.map((run) => {
      const resultCount = sourceRecordCounts.get(run.sourceId) ?? 0;
      const source = getSource(run.sourceId)!;
      if (source.searchCapability !== "manual") {
        return {
          ...run,
          resultCount,
          message: run.message
            ? `Imported, not revalidated: ${run.message}`
            : "Imported source-run status; not revalidated."
        };
      }
      const manualHandoff = buildManualSearchHandoff(source, project.plan);
      const unavailable = source.adapterStatus === "temporarily_unavailable";
      return {
        ...run,
        status: unavailable ? "temporarily_unavailable" : "manual_available",
        resultCount,
        manualSearchUrl: source.manualSearchUrl,
        message: unavailable
          ? "Imported manual handoff; the current source registry marks this repository temporarily unavailable."
          : "Imported manual handoff; source status and prior search activity were not revalidated.",
        manualHandoff: {
          ...manualHandoff,
          researcherResultCount: resultCount
        }
      };
    })
  };
}
