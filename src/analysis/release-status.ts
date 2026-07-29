import type { ReleaseDetermination, ReleaseStatus } from "../core/types";

export interface ReleaseSignals {
  explicitFullRelease?: boolean;
  officialStatus?: string;
  researcherDetermination?: ReleaseStatus;
  hasDigitalObject?: boolean;
  hasRedactionMarking?: boolean;
  metadataOnly?: boolean;
  findingAidOnly?: boolean;
  withdrawalNoticeOnly?: boolean;
}

export function determineReleaseStatus(signals: ReleaseSignals, source: string): ReleaseDetermination {
  if (signals.researcherDetermination) {
    return {
      status: signals.researcherDetermination,
      determinationBasis: "Manual researcher determination",
      source: "researcher",
      confidence: 1,
      humanReview: true
    };
  }
  if (signals.explicitFullRelease || /\b(released|declassified)\s+in\s+full\b/i.test(signals.officialStatus ?? "")) {
    return {
      status: "released_in_full",
      determinationBasis: "Explicit official full-release language",
      source,
      confidence: 0.95,
      humanReview: false
    };
  }
  if (/\b(released|declassified)\s+in\s+part\b|\bRIP\b/i.test(signals.officialStatus ?? "")) {
    return {
      status: "released_in_part",
      determinationBasis: "Official source reports a partial release",
      source,
      confidence: 0.9,
      humanReview: false
    };
  }
  if (signals.withdrawalNoticeOnly) {
    return {
      status: "withdrawal_notice_only",
      determinationBasis: "Only an official withdrawal or denial notice is available",
      source,
      confidence: 0.9,
      humanReview: false
    };
  }
  if (signals.findingAidOnly) {
    return {
      status: "finding_aid_only",
      determinationBasis: "The source provides a finding aid rather than the record",
      source,
      confidence: 0.9,
      humanReview: false
    };
  }
  if (signals.metadataOnly || !signals.hasDigitalObject) {
    return {
      status: signals.metadataOnly ? "metadata_only" : "described_but_not_digitized",
      determinationBasis: signals.metadataOnly
        ? "Official source provides metadata without a public digital object"
        : "Record is described but no public digital object was reported",
      source,
      confidence: 0.85,
      humanReview: false
    };
  }
  if (signals.hasRedactionMarking) {
    return {
      status: "released_with_redactions_status_unclear",
      determinationBasis: "A public copy and visible redaction indicator exist, but no controlled official status was supplied",
      source,
      confidence: 0.7,
      humanReview: true
    };
  }
  return {
    status: "not_determined",
    determinationBasis: "A public copy is available, but absence of visible redactions is not evidence of full release",
    source,
    confidence: 0.55,
    humanReview: true
  };
}
