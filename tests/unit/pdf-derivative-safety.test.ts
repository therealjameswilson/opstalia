import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName } from "pdf-lib";
import { processDerivativeBatch } from "../../src/pdf/derivative-processor";

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sourcePdf(annotated = false): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const first = document.addPage([400, 400]);
  first.drawText("COVERED OFFICIAL TEXT", { x: 80, y: 205, size: 18 });
  const second = document.addPage([400, 400]);
  second.drawText("SECOND PAGE", { x: 80, y: 205, size: 18 });
  second.node.set(PDFName.of("AA"), document.context.obj({ O: document.context.obj({ S: PDFName.of("JavaScript") }) }));

  if (annotated) {
    const appearance = document.context.flateStream(
      "q 0 0 0 rg 0 0 260 35 re f Q",
      { BBox: [0, 0, 260, 35], Resources: {} }
    );
    const annotation = document.context.obj({
      Type: PDFName.of("Annot"),
      Subtype: PDFName.of("Square"),
      Rect: [70, 195, 330, 230],
      F: 4,
      AP: { N: document.context.register(appearance) }
    });
    first.node.set(PDFName.of("Annots"), document.context.obj([document.context.register(annotation)]));
  }
  return document.save({ useObjectStreams: false });
}

function request(sourceBytes: Uint8Array, expectedSourceSha256: string) {
  return {
    sourceBytes: Uint8Array.from(sourceBytes).buffer,
    expectedSourceSha256,
    ranges: [{
      segmentId: "segment-1",
      startPage: 1,
      endPage: 2,
      title: "Reviewed range",
      provenance: "Researcher-created test derivative"
    }]
  };
}

describe("PDF derivative processor safety", () => {
  it("refuses the whole derivative when a selected page has any annotation", async () => {
    const source = await sourcePdf(true);
    await expect(processDerivativeBatch(request(source, await sha256(source))))
      .rejects.toThrow(/page 1 contains annotations/i);
  });

  it("checks the reviewed source fingerprint before parsing the PDF", async () => {
    const malformed = new TextEncoder().encode("not a PDF");
    await expect(processDerivativeBatch(request(malformed, "0".repeat(64))))
      .rejects.toThrow(/source hash changed/i);
  });

  it("creates annotation-free derivatives and removes active page actions", async () => {
    const source = await sourcePdf(false);
    const result = await processDerivativeBatch(request(source, await sha256(source)));
    expect(result.outputs).toHaveLength(1);
    expect(result.outputs[0]).toMatchObject({ segmentId: "segment-1", pageCount: 2 });

    const derivative = await PDFDocument.load(result.outputs[0].output);
    expect(derivative.getPageCount()).toBe(2);
    expect(derivative.getPage(0).node.get(PDFName.of("Annots"))).toBeUndefined();
    expect(derivative.getPage(1).node.get(PDFName.of("AA"))).toBeUndefined();
  });
});
