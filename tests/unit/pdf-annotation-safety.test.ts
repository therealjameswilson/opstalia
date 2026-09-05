import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { inspectOfficialPdfPageText } from "../../src/pdf/pdf-engine";

async function testPdf(annotated: boolean, annotationFlags = 4): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 400]);
  page.drawText("COVERED OFFICIAL TEXT", { x: 80, y: 205, size: 18 });

  if (annotated) {
    const context = document.context;
    const appearance = context.flateStream(
      "q 0 0 0 rg 0 0 260 35 re f Q",
      { BBox: [0, 0, 260, 35], Resources: {} }
    );
    const appearanceRef = context.register(appearance);
    const annotation = context.obj({
      Type: PDFName.of("Annot"),
      Subtype: PDFName.of("Square"),
      Rect: [70, 195, 330, 230],
      F: annotationFlags,
      AP: { N: appearanceRef }
    });
    page.node.set(PDFName.of("Annots"), context.obj([context.register(annotation)]));
  }

  return document.save({ useObjectStreams: false });
}

async function loadedPdf(annotated: boolean, annotationFlags = 4) {
  return getDocument({
    data: await testPdf(annotated, annotationFlags),
    enableXfa: false,
    isEvalSupported: false
  }).promise;
}

describe("PDF annotation safety", () => {
  it("suppresses embedded text on any page with annotations", async () => {
    const document = await loadedPdf(true);
    try {
      await expect(inspectOfficialPdfPageText(document, 1)).resolves.toEqual({
        text: "",
        annotationCount: 1,
        textSuppressedForAnnotations: true
      });
    } finally {
      await document.destroy();
    }
  });

  it("suppresses text for a NoView annotation omitted from display-only queries", async () => {
    const document = await loadedPdf(true, 32);
    try {
      const page = await document.getPage(1);
      expect(await page.getAnnotations({ intent: "display" })).toHaveLength(0);
      await expect(inspectOfficialPdfPageText(document, 1)).resolves.toEqual({
        text: "",
        annotationCount: 1,
        textSuppressedForAnnotations: true
      });
    } finally {
      await document.destroy();
    }
  });

  it("retains bounded embedded-text extraction on an annotation-free page", async () => {
    const document = await loadedPdf(false);
    try {
      await expect(inspectOfficialPdfPageText(document, 1)).resolves.toEqual({
        text: "COVERED OFFICIAL TEXT",
        annotationCount: 0,
        textSuppressedForAnnotations: false
      });
    } finally {
      await document.destroy();
    }
  });
});
