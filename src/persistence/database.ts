import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { NormalizedRecord, SearchProject } from "../core/types";
import { projectImportSchema } from "../core/validation";
import { getSource } from "../data/registry";
import { isApprovedOfficialUrl, validatePrimaryEvidence } from "../security/url-policy";

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
}

const DATABASE_NAME = "opstalia-v1-research";
let databasePromise: Promise<IDBPDatabase<OpstaliaDatabase>> | undefined;

function db(): Promise<IDBPDatabase<OpstaliaDatabase>> {
  databasePromise ??= openDB<OpstaliaDatabase>(DATABASE_NAME, 1, {
    upgrade(database) {
      const projects = database.createObjectStore("projects", { keyPath: "id" });
      projects.createIndex("by-updated", "updatedAt");
      database.createObjectStore("preferences", { keyPath: "key" });
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
      normalizationVersion: "1.0.0-locator-only"
    },
    retrievalTimestamp: record.retrievalTimestamp,
    confidenceScore: 0,
    matchExplanation: [],
    review: record.review
  };
}

export function sanitizeProjectForPersistence(project: SearchProject): SearchProject {
  const naraRecordIds = new Set(
    project.records
      .filter((record) => record.provenance.sourceId === "nara")
      .map((record) => record.id)
  );
  return {
    ...project,
    rawRecords: project.rawRecords.filter((record) => record.sourceId !== "nara"),
    records: project.records.map((record) => (record.provenance.sourceId === "nara" ? generatedLocator(record) : record)),
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
  const transaction = database.transaction(["projects", "preferences"], "readwrite");
  await Promise.all([transaction.objectStore("projects").clear(), transaction.objectStore("preferences").clear()]);
  await transaction.done;
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
    if (!source || (run.manualSearchUrl && !isApprovedOfficialUrl(run.manualSearchUrl, source))) {
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
    const officialUrls = [
      record.recordPageUrl.value,
      record.downloadUrl?.value,
      record.thumbnailUrl?.value,
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
  return project;
}
