import { demoFixtures, getSource } from "./registry";
import { buildSearchPlan } from "../search/query-expansion";
import { makeId } from "../core/id";
import { groupVersions } from "../analysis/versioning";
import { validatePrimaryEvidence } from "../security/url-policy";
import type {
  NormalizedRecord,
  ReleaseStatus,
  SearchProject,
  SearchTarget,
  SourcedValue,
  VersionGroup,
  VersionRelationshipLabel
} from "../core/types";

interface FixtureRecord {
  sourceId: string;
  title: string;
  date?: string;
  naraNaid?: string;
  documentNumber?: string;
  documentType?: string;
  pageCount?: number;
  sourceRepository: string;
  officialUrl: string;
  recordPageUrl: string;
  downloadUrl?: string;
  releaseStatus: ReleaseStatus;
  determinationBasis: string;
  exemptionCodes: string[];
}

function fixtureValue<T>(value: T, officialUrl: string): SourcedValue<T> {
  return {
    value,
    source: officialUrl,
    extractionMethod: "source_reported",
    confidence: 0.95
  };
}

function normalizeFixture(record: FixtureRecord, projectId: string): NormalizedRecord {
  const retrievedAt = "2026-07-29T00:00:00.000Z";
  const normalized: NormalizedRecord = {
    id: makeId("fixture-record", `${projectId}|${record.sourceId}|${record.officialUrl}`),
    title: fixtureValue(record.title, record.officialUrl),
    date: record.date ? fixtureValue(record.date, record.officialUrl) : undefined,
    datePrecision: record.date ? fixtureValue("day" as const, record.officialUrl) : undefined,
    documentType: record.documentType ? fixtureValue(record.documentType, record.officialUrl) : undefined,
    sourceRepository: fixtureValue(record.sourceRepository, record.officialUrl),
    officialUrl: fixtureValue(record.officialUrl, record.officialUrl),
    recordPageUrl: fixtureValue(record.recordPageUrl, record.officialUrl),
    downloadUrl: record.downloadUrl ? fixtureValue(record.downloadUrl, record.officialUrl) : undefined,
    naraNaid: record.naraNaid ? fixtureValue(record.naraNaid, record.officialUrl) : undefined,
    documentNumber: record.documentNumber ? fixtureValue(record.documentNumber, record.officialUrl) : undefined,
    pageCount: record.pageCount ? fixtureValue(record.pageCount, record.officialUrl) : undefined,
    digitizationStatus: fixtureValue("Official public digital object linked in fixture", record.officialUrl),
    ocrAvailability: fixtureValue(false, record.officialUrl),
    releaseStatus: {
      status: record.releaseStatus,
      determinationBasis: record.determinationBasis,
      source: record.officialUrl,
      confidence: record.releaseStatus === "released_in_part" ? 0.98 : 0.75,
      humanReview: record.releaseStatus !== "released_in_part"
    },
    exemptionCodes: record.exemptionCodes,
    classificationMarkings: record.exemptionCodes.map((code) => ({
      id: makeId("fixture-marking", `${projectId}|${record.officialUrl}|${code}`),
      code,
      text: code,
      confidence: 0.95,
      detectionMethod: "source_reported"
    })),
    extractedIdentifiers: [record.naraNaid, record.documentNumber].filter((value): value is string => Boolean(value)),
    digitalObjects: record.downloadUrl
      ? [
          {
            id: makeId("fixture-object", record.downloadUrl),
            url: record.downloadUrl,
            downloadUrl: record.downloadUrl,
            mediaType: "application/pdf"
          }
        ]
      : [],
    provenance: {
      adapterId: record.sourceId,
      sourceId: record.sourceId,
      officialDomain: new URL(record.officialUrl).hostname,
      officialRecordUrl: record.officialUrl,
      retrievalTimestamp: retrievedAt,
      normalizationVersion: "1.0.0-fixture",
      fixture: true
    },
    retrievalTimestamp: retrievedAt,
    confidenceScore: record.naraNaid ? 100 : record.releaseStatus === "released_in_part" ? 90 : 82,
    matchExplanation: record.naraNaid
      ? [{ label: "Exact identifier match", points: 35, detail: `NAID ${record.naraNaid}` }]
      : [{ label: "Demonstration fixture", points: 0, detail: "Use live search to recalculate a query-specific score." }],
    review: { disposition: "unreviewed" }
  };
  const source = getSource(record.sourceId);
  if (!validatePrimaryEvidence(record.officialUrl, normalized.provenance, source).allowed) {
    throw new Error(`Fixture official URL failed source-registry validation: ${record.officialUrl}`);
  }
  return normalized;
}

export function createDemoProjects(): SearchProject[] {
  return demoFixtures.projects.map((fixture) => {
    const target = fixture.target as SearchTarget;
    const plan = buildSearchPlan(target);
    const records = fixture.records.map((record) => normalizeFixture(record as FixtureRecord, fixture.id));
    let groups: VersionGroup[] = groupVersions(records);
    const seededRelationship = "seededRelationship" in fixture ? fixture.seededRelationship : undefined;
    if (seededRelationship && records.length === 2) {
      groups = [
        {
          id: makeId("fixture-group", fixture.id),
          label: fixture.name,
          recordIds: records.map((record) => record.id),
          relationships: [
            {
              id: makeId("fixture-relationship", fixture.id),
              leftRecordId: records[0].id,
              rightRecordId: records[1].id,
              label: seededRelationship.label as VersionRelationshipLabel,
              score: 78,
              reasons: seededRelationship.basis
            }
          ],
          reviewStatus: "awaiting_review"
        }
      ];
    }
    return {
      id: fixture.id,
      name: fixture.name,
      createdAt: "2026-07-29T00:00:00.000Z",
      updatedAt: "2026-07-29T00:00:00.000Z",
      target,
      plan,
      sourceRuns: [],
      rawRecords: [],
      records,
      savedRecordIds: records.map((record) => record.id),
      versionGroups: groups,
      comparisons: [],
      notes: [],
      auditEvents: [
        {
          id: makeId("fixture-audit", fixture.id),
          timestamp: "2026-07-29T00:00:00.000Z",
          action: "Loaded checked-in demonstration fixture",
          basis: demoFixtures.warning,
          actor: "opstalia"
        }
      ],
      privateMode: false,
      fixture: true
    };
  });
}
