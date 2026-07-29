import { describe, expect, it } from "vitest";
import { determineReleaseStatus } from "../../src/analysis/release-status";

describe("cautious release-status model", () => {
  it("does not call a digital copy released in full", () => {
    expect(determineReleaseStatus({ hasDigitalObject: true }, "official source")).toMatchObject({
      status: "not_determined",
      humanReview: true
    });
  });

  it("requires explicit official or human basis for full release", () => {
    expect(determineReleaseStatus({ explicitFullRelease: true }, "agency metadata").status).toBe("released_in_full");
    expect(determineReleaseStatus({ researcherDetermination: "released_in_full" }, "researcher")).toMatchObject({
      status: "released_in_full",
      humanReview: true
    });
  });

  it("keeps finding aids, withdrawal notices, and metadata separate", () => {
    expect(determineReleaseStatus({ findingAidOnly: true }, "NDC").status).toBe("finding_aid_only");
    expect(determineReleaseStatus({ withdrawalNoticeOnly: true }, "NARA").status).toBe("withdrawal_notice_only");
    expect(determineReleaseStatus({ metadataOnly: true }, "NARA").status).toBe("metadata_only");
  });
});
