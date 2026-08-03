import { describe, expect, it } from "vitest";
import { proposePacketSegments } from "../../src/pdf/detect-boundaries";
import { mergePageRanges, rangesOverlap, splitPageRange, validatePageRange } from "../../src/pdf/page-ranges";
import { packetManifest, packetManifestCsv, packetManifestMarkdown } from "../../src/pdf/provenance-manifest";
import { resolvePdfContentUrl } from "../../src/pdf/client";
import type { PdfPacketProject } from "../../src/core/types";
import { pdfPacketProjectSchema } from "../../src/core/validation";

function project(): PdfPacketProject {
  return {
    id: "packet-1",
    name: "Official packet review",
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
    privateMode: false,
    source: {
      sourceId: "presidential-libraries",
      title: "Official packet review",
      officialPdfUrl: "https://catalog.archives.gov/medialz/presidential-libraries/bush/example/packet.pdf",
      officialRecordUrl: "https://catalog.archives.gov/id/123",
      naraNaid: "123",
      pageCount: 12,
      byteLength: 1000,
      inspectedAt: "2026-08-03T00:00:00.000Z"
    },
    segments: [],
    scan: { pagesScanned: 0, pagesWithText: 0 }
  };
}

describe("PDF packet page ranges", () => {
  it("validates, merges, and splits bounded ranges", () => {
    expect(validatePageRange(2, 5, 10).valid).toBe(true);
    expect(validatePageRange(5, 2, 10).reason).toMatch(/cannot precede/);
    expect(validatePageRange(2, 11, 10).reason).toMatch(/10 pages/);
    expect(rangesOverlap({ startPage: 2, endPage: 5 }, { startPage: 5, endPage: 7 })).toBe(true);
    expect(mergePageRanges([
      { startPage: 8, endPage: 9 },
      { startPage: 2, endPage: 4 },
      { startPage: 5, endPage: 6 }
    ])).toEqual([
      { startPage: 2, endPage: 6 },
      { startPage: 8, endPage: 9 }
    ]);
    expect(splitPageRange({ startPage: 2, endPage: 8 }, 5)).toEqual([
      { startPage: 2, endPage: 4 },
      { startPage: 5, endPage: 8 }
    ]);
  });
});

describe("PDF relay session URLs", () => {
  it("accepts only the Worker's bounded relative content route", () => {
    const token = "payload_token.signature_token";
    expect(resolvePdfContentUrl(`/api/pdf/content?token=${token}`, "https://api.example.test")).toBe(
      `https://api.example.test/api/pdf/content?token=${token}`
    );
    expect(() => resolvePdfContentUrl("https://evil.example/api/pdf/content?token=x.y", "https://api.example.test"))
      .toThrow(/invalid content path/i);
    expect(() => resolvePdfContentUrl("/api/pdf/content?token=x.y&next=https://evil.example", "https://api.example.test"))
      .toThrow(/invalid content path/i);
  });
});

describe("deterministic packet proposals", () => {
  it("keeps physical content and withdrawal-sheet descriptions in separate lanes", () => {
    const segments = proposePacketSegments([
      { pageNumber: 1, text: "MEMORANDUM OF CONVERSATION SUBJECT: Paris Summit PARTICIPANTS: President Bush November 1990" },
      { pageNumber: 2, text: "Discussion continues END OF MEETING" },
      { pageNumber: 3, text: "Withdrawal/Redaction Sheet 2. Memorandum (3 pp.) (b)(1)" },
      { pageNumber: 4, text: "MEMORANDUM FOR THE PRESIDENT SUBJECT: CSCE Follow-up December 1990" }
    ], 8, "2026-08-03T00:00:00.000Z");

    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatchObject({
      kind: "page_range",
      startPage: 1,
      endPage: 2,
      reviewStatus: "proposed",
      releaseStatus: { status: "not_determined", humanReview: true }
    });
    expect(segments[1]).toMatchObject({
      kind: "described_item",
      evidencePages: [3],
      describedExtent: 3,
      startPage: undefined,
      endPage: undefined,
      releaseStatus: { status: "withdrawal_notice_only" }
    });
    expect(segments[2]).toMatchObject({ kind: "page_range", startPage: 4, endPage: 8 });
  });

  it("does not invent a boundary from a generic letterhead alone", () => {
    expect(proposePacketSegments([
      { pageNumber: 1, text: "THE WHITE HOUSE WASHINGTON" },
      { pageNumber: 2, text: "ordinary briefing text" }
    ], 2)).toEqual([]);
  });
});

describe("packet manifest boundary", () => {
  it("rejects out-of-bounds segments and inconsistent scan counts", () => {
    const invalid = project();
    invalid.segments = proposePacketSegments([
      { pageNumber: 1, text: "MEMORANDUM OF CONVERSATION SUBJECT: Test PARTICIPANTS: A" }
    ], 20);
    invalid.scan = { pagesScanned: 13, pagesWithText: 14 };
    expect(pdfPacketProjectSchema.safeParse(invalid).success).toBe(false);
  });

  it("labels derivatives cautiously and neutralizes spreadsheet formulas", () => {
    const value = project();
    value.segments = [{
      id: "segment-1",
      kind: "page_range",
      title: "=SUM(A1:A2)",
      startPage: 2,
      endPage: 3,
      releaseStatus: {
        status: "not_determined",
        determinationBasis: "Researcher-created range",
        source: "researcher",
        confidence: 1,
        humanReview: true
      },
      detectionMethod: "researcher_defined",
      confidence: 1,
      reasons: ["Researcher-defined"],
      reviewStatus: "researcher_confirmed",
      createdAt: value.createdAt,
      updatedAt: value.updatedAt
    }];
    expect(packetManifestMarkdown(value)).toContain("Research derivative — not an official source file");
    expect(packetManifestMarkdown(value)).toContain("not proof of an official standalone release");
    expect(packetManifestMarkdown(value)).toContain("not verified by Opstalia");
    expect(packetManifest(value)).toMatchObject({
      researcherSuppliedAssociation: { associationVerifiedByOpstalia: false }
    });
    expect(packetManifestCsv(value)).toContain("'=SUM(A1:A2)");
  });
});
