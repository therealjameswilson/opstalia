import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { PdfPacketProject, PdfPacketSegment } from "../../src/core/types";
import {
  buildBatchResearchPacket,
  createBatchExportPlan,
  MAX_BATCH_DERIVATIVES,
  MAX_BATCH_SELECTED_PAGES
} from "../../src/pdf/batch-export";

const NOW = "2026-09-04T12:00:00.000Z";

function segment(
  id: string,
  kind: PdfPacketSegment["kind"],
  reviewStatus: PdfPacketSegment["reviewStatus"],
  values: Partial<PdfPacketSegment> = {}
): PdfPacketSegment {
  return {
    id,
    kind,
    title: values.title ?? id,
    startPage: values.startPage,
    endPage: values.endPage,
    evidencePages: values.evidencePages,
    describedExtent: values.describedExtent,
    date: values.date,
    documentType: values.documentType,
    identifier: values.identifier,
    releaseStatus: values.releaseStatus ?? {
      status: "not_determined",
      determinationBasis: "Researcher-created packet locator",
      source: "researcher",
      confidence: 1,
      humanReview: true
    },
    detectionMethod: values.detectionMethod ?? "researcher_defined",
    confidence: values.confidence ?? 1,
    reasons: values.reasons ?? ["Researcher-defined"],
    reviewStatus,
    createdAt: NOW,
    updatedAt: NOW
  };
}

function project(segments: PdfPacketSegment[], pageCount = 12): PdfPacketProject {
  return {
    id: "packet-1",
    name: "Western Europe review packet",
    createdAt: NOW,
    updatedAt: NOW,
    privateMode: false,
    source: {
      sourceId: "presidential-libraries",
      title: "Official packet",
      officialPdfUrl: "https://catalog.archives.gov/medialz/presidential-libraries/bush/example/packet.pdf",
      officialRecordUrl: "https://catalog.archives.gov/id/123",
      naraNaid: "123",
      pageCount,
      byteLength: 10_000,
      sha256: "a".repeat(64),
      inspectedAt: NOW
    },
    segments,
    scan: { pagesScanned: 0, pagesWithText: 0 }
  };
}

function fakePdf(label: string): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.7\n${label}\n%%EOF\n`);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("batch packet planning", () => {
  it("selects only confirmed or corrected page ranges in stable source-page order", () => {
    const value = project([
      segment("proposed", "page_range", "proposed", { startPage: 2, endPage: 3 }),
      segment("later", "page_range", "researcher_confirmed", { startPage: 8, endPage: 9 }),
      segment("first", "page_range", "researcher_corrected", { startPage: 1, endPage: 2 }),
      segment("same-start-a", "page_range", "researcher_confirmed", { startPage: 5, endPage: 6 }),
      segment("same-start-b", "page_range", "researcher_confirmed", { startPage: 5, endPage: 7 }),
      segment("rejected", "page_range", "researcher_rejected", { startPage: 10, endPage: 10 }),
      segment("withdrawal", "described_item", "researcher_confirmed", {
        evidencePages: [11],
        describedExtent: 3
      })
    ]);

    const plan = createBatchExportPlan(value);

    expect(plan.derivativeItems.map((item) => item.segmentId)).toEqual([
      "first",
      "same-start-a",
      "same-start-b",
      "later"
    ]);
    expect(plan.excludedPageRanges.map((item) => item.segmentId)).toEqual(["proposed", "rejected"]);
    expect(plan.manifestOnlyItems).toEqual([
      expect.objectContaining({ segmentId: "withdrawal", kind: "described_item", describedExtent: 3 })
    ]);
  });

  it("detects invalid, out-of-bounds, duplicate, overlapping, and uncovered ranges", () => {
    const value = project([
      segment("duplicate-a", "page_range", "researcher_confirmed", { startPage: 1, endPage: 3 }),
      segment("duplicate-b", "page_range", "researcher_corrected", { startPage: 1, endPage: 3 }),
      segment("overlap", "page_range", "researcher_confirmed", { startPage: 3, endPage: 5 }),
      segment("backward", "page_range", "researcher_confirmed", { startPage: 7, endPage: 6 }),
      segment("outside", "page_range", "researcher_confirmed", { startPage: 8, endPage: 13 })
    ], 12);

    const plan = createBatchExportPlan(value);
    const codes = plan.issues.map((issue) => issue.code);

    expect(codes).toEqual(expect.arrayContaining([
      "invalid_range",
      "out_of_bounds",
      "exact_duplicate",
      "overlap",
      "uncovered_source_gap"
    ]));
    expect(plan.uncoveredRanges).toEqual([{ startPage: 6, endPage: 12 }]);
    expect(plan.canExport).toBe(false);
  });

  it("creates path-safe, collision-free, numbered filenames", () => {
    const value = project([
      segment("unsafe-a", "page_range", "researcher_confirmed", {
        title: "../../CON: Malta / Summit?",
        startPage: 1,
        endPage: 2,
        date: "1990-11-18",
        documentType: "Memcon/../../",
        identifier: "OA\\ID 123"
      }),
      segment("unsafe-b", "page_range", "researcher_confirmed", {
        title: "../../CON: Malta / Summit?",
        startPage: 3,
        endPage: 4,
        date: "1990-11-18",
        documentType: "Memcon/../../",
        identifier: "OA\\ID 123"
      })
    ], 4);

    const names = createBatchExportPlan(value).derivativeItems.map((item) => item.fileName);

    expect(names[0]).toMatch(/^001_1990-11-18_memcon_oa-id-123_con-malta-summit_p0001-p0002\.pdf$/);
    expect(names[1]).toMatch(/^002_1990-11-18_memcon_oa-id-123_con-malta-summit_p0003-p0004\.pdf$/);
    expect(new Set(names.map((name) => name.toLocaleLowerCase())).size).toBe(2);
    expect(names.every((name) => !/[\\/]|\.\./.test(name))).toBe(true);
  });

  it("exports a chosen reviewed subset and records the rest as not selected", async () => {
    const value = project([
      segment("first", "page_range", "researcher_confirmed", { startPage: 1, endPage: 2 }),
      segment("second", "page_range", "researcher_corrected", { startPage: 3, endPage: 4 }),
      segment("description", "described_item", "researcher_confirmed", { evidencePages: [5] })
    ], 5);
    const options = { selectedSegmentIds: ["second"] };
    const plan = createBatchExportPlan(value, options);

    expect(plan.derivativeItems.map((item) => item.segmentId)).toEqual(["second"]);
    expect(plan.excludedPageRanges).toContainEqual(expect.objectContaining({
      segmentId: "first",
      reason: expect.stringMatching(/not selected for this batch/i)
    }));
    expect(plan.manifestOnlyItems).toContainEqual(expect.objectContaining({ segmentId: "description" }));

    const result = await buildBatchResearchPacket(value, [
      { segmentId: "second", pdfBytes: fakePdf("second") }
    ], { ...options, generatedAt: NOW });
    const register = strFromU8(unzipSync(result.zipBytes)["register.csv"]);

    expect(register).toContain('"first","page_range","first","1","2","","","","","","researcher_confirmed","not_determined","not_selected"');
    expect(register).toContain('"second","page_range","second","3","4","","","","","","researcher_corrected","not_determined","derivative_in_package"');
  });

  it("enforces conservative derivative-count and selected-page limits", () => {
    const tooMany = project(
      Array.from({ length: MAX_BATCH_DERIVATIVES + 1 }, (_, index) =>
        segment(`segment-${index}`, "page_range", "researcher_confirmed", {
          startPage: index + 1,
          endPage: index + 1
        })
      ),
      MAX_BATCH_DERIVATIVES + 1
    );
    const tooManyPages = project([
      segment("huge-range", "page_range", "researcher_confirmed", {
        startPage: 1,
        endPage: MAX_BATCH_SELECTED_PAGES + 1
      })
    ], MAX_BATCH_SELECTED_PAGES + 1);

    expect(createBatchExportPlan(tooMany).issues).toContainEqual(
      expect.objectContaining({ code: "derivative_limit_exceeded", severity: "error" })
    );
    expect(createBatchExportPlan(tooManyPages).issues).toContainEqual(
      expect.objectContaining({ code: "page_limit_exceeded", severity: "error" })
    );
  });
});

describe("batch research packet packaging", () => {
  it("packages derivatives, manifests described-only items, and writes verifiable checksums", async () => {
    const value = project([
      segment("second", "page_range", "researcher_confirmed", {
        title: "Second memorandum",
        startPage: 4,
        endPage: 5
      }),
      segment("description", "described_item", "researcher_confirmed", {
        title: "Withdrawal sheet entry",
        evidencePages: [3],
        describedExtent: 2,
        releaseStatus: {
          status: "withdrawal_notice_only",
          determinationBasis: "Visible withdrawal sheet",
          source: "researcher",
          confidence: 1,
          humanReview: true
        }
      }),
      segment("first", "page_range", "researcher_corrected", {
        title: "First memorandum",
        startPage: 1,
        endPage: 2
      }),
      segment("pending", "page_range", "proposed", {
        title: "Unreviewed proposal",
        startPage: 6,
        endPage: 6
      })
    ], 6);
    const firstBytes = fakePdf("first");
    const secondBytes = fakePdf("second");
    const result = await buildBatchResearchPacket(value, [
      { segmentId: "second", pdfBytes: secondBytes },
      { segmentId: "first", pdfBytes: firstBytes }
    ], { generatedAt: NOW });
    const entries = unzipSync(result.zipBytes);
    const paths = Object.keys(entries).sort();

    expect(paths).toEqual([
      "README.md",
      "SHA256SUMS.txt",
      "documents/001_first-memorandum_p0001-p0002.pdf",
      "documents/002_second-memorandum_p0004-p0005.pdf",
      "manifest.json",
      "register.csv"
    ]);
    expect(paths.some((path) => /source.*\.pdf/i.test(path))).toBe(false);
    const manifest = JSON.parse(strFromU8(entries["manifest.json"])) as {
      batch: {
        derivativeCount: number;
        manifestOnlyItems: Array<{ segmentId: string }>;
        excludedPageRanges: Array<{ segmentId: string }>;
      };
      exclusions: string[];
    };
    expect(manifest.batch.derivativeCount).toBe(2);
    expect(manifest.batch.manifestOnlyItems).toContainEqual(expect.objectContaining({ segmentId: "description" }));
    expect(manifest.batch.excludedPageRanges).toContainEqual(expect.objectContaining({ segmentId: "pending" }));
    expect(manifest.exclusions).toContain("Extracted or OCR page text");
    expect(strFromU8(entries["register.csv"])).toContain('"description","described_item","Withdrawal sheet entry"');
    expect(strFromU8(entries["register.csv"])).toContain('"manifest_only"');
    expect(strFromU8(entries["README.md"])).toContain("described item only");

    const sums = new Map(
      strFromU8(entries["SHA256SUMS.txt"])
        .trim()
        .split("\n")
        .map((line) => {
          const match = line.match(/^([a-f0-9]{64}) {2}(.+)$/);
          if (!match) throw new Error(`Malformed checksum line: ${line}`);
          return [match[2], match[1]];
        })
    );
    expect(sums.has("SHA256SUMS.txt")).toBe(false);
    for (const path of paths.filter((path) => path !== "SHA256SUMS.txt")) {
      expect(sums.get(path)).toBe(await sha256(entries[path]));
    }
  });

  it("rejects a bad expected derivative checksum", async () => {
    const value = project([
      segment("only", "page_range", "researcher_confirmed", {
        startPage: 1,
        endPage: 1
      })
    ], 1);
    await expect(buildBatchResearchPacket(value, [{
      segmentId: "only",
      pdfBytes: fakePdf("only"),
      expectedSha256: "0".repeat(64)
    }], { generatedAt: NOW })).rejects.toThrow(/checksum did not match/i);
  });

  it("neutralizes spreadsheet formulas and Markdown injection in package manifests", async () => {
    const value = project([
      segment("unsafe", "page_range", "researcher_confirmed", {
        title: "=HYPERLINK(\"https://example.invalid\")\n<script>alert(1)</script>",
        startPage: 1,
        endPage: 1,
        reasons: ["[click](javascript:alert(1))"]
      })
    ], 1);
    value.name = "Packet\n<script>alert(1)</script>";
    const result = await buildBatchResearchPacket(value, [
      { segmentId: "unsafe", pdfBytes: fakePdf("unsafe") }
    ], { generatedAt: NOW });
    const entries = unzipSync(result.zipBytes);
    const register = strFromU8(entries["register.csv"]);
    const readme = strFromU8(entries["README.md"]);

    expect(register).toContain("'=");
    expect(readme).not.toContain("<script>");
    expect(readme).toContain("&lt;script&gt;");
  });
});
