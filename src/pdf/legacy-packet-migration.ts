import type { PdfPacketProject } from "../core/types";

function removeLegacyDerivativeHash(notes?: string): string | undefined {
  if (!notes) return notes;
  const lines = notes.split("\n");
  if (!lines.some((line) => line.startsWith("Latest derivative SHA-256:"))) return notes;
  const retained = lines.filter((line) => !line.startsWith("Latest derivative SHA-256:"));
  retained.push("Prior derivative hash removed by the annotation-safety upgrade; regenerate after re-review.");
  return retained.join("\n");
}

export interface LegacyPacketMigrationResult {
  project: PdfPacketProject;
  migrated: boolean;
  removedPatternSuggestions: number;
}

export function migrateLegacyPacketAnnotationSafety(
  project: PdfPacketProject,
  migratedAt = new Date().toISOString()
): LegacyPacketMigrationResult {
  const annotationAwareScan =
    project.scan.pagesWithAnnotations !== undefined &&
    project.scan.annotationPages !== undefined;
  if (annotationAwareScan) {
    return { project, migrated: false, removedPatternSuggestions: 0 };
  }

  const removedPatternSuggestions = project.segments.filter(
    (segment) => segment.detectionMethod === "pattern_match"
  ).length;
  const retainedSegments = project.segments
    .filter((segment) => segment.detectionMethod !== "pattern_match")
    .map((segment) => ({
      ...segment,
      notes: removeLegacyDerivativeHash(segment.notes),
      derivativeExports: undefined,
      reviewStatus: segment.reviewStatus === "researcher_rejected"
        ? "researcher_rejected" as const
        : "proposed" as const,
      reasons: [...new Set([
        ...segment.reasons,
        "Pre-1.3 packet review reset because earlier scans did not suppress annotation-bearing page text"
      ])],
      updatedAt: migratedAt
    }));

  return {
    migrated: true,
    removedPatternSuggestions,
    project: {
      ...project,
      updatedAt: migratedAt,
      segments: retainedSegments,
      scan: {
        pagesScanned: 0,
        pagesWithText: 0,
        pagesWithAnnotations: 0,
        annotationPages: []
      }
    }
  };
}
