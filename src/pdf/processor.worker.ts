/// <reference lib="webworker" />

import { PDFDocument, PDFName } from "pdf-lib";

interface ExportRequest {
  id: string;
  sourceBytes: ArrayBuffer;
  startPage: number;
  endPage: number;
  title: string;
  provenance: string;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

self.onmessage = async (event: MessageEvent<ExportRequest>) => {
  const request = event.data;
  try {
    const source = new Uint8Array(request.sourceBytes);
    const sourceSha256 = await sha256(source);
    const original = await PDFDocument.load(source, {
      ignoreEncryption: false,
      updateMetadata: false,
      throwOnInvalidObject: true
    });
    if (request.startPage < 1 || request.endPage > original.getPageCount() || request.endPage < request.startPage) {
      throw new Error("The requested page range is outside the source PDF.");
    }
    const derivative = await PDFDocument.create();
    const indices = Array.from(
      { length: request.endPage - request.startPage + 1 },
      (_, index) => request.startPage - 1 + index
    );
    const pages = await derivative.copyPages(original, indices);
    for (const page of pages) {
      page.node.delete(PDFName.of("AA"));
      page.node.delete(PDFName.of("Annots"));
      derivative.addPage(page);
    }
    derivative.setTitle(request.title);
    derivative.setSubject(`Research derivative. Active page actions and annotations were removed for safety. ${request.provenance}`);
    derivative.setCreator("Opstalia PDF Packet Lab");
    derivative.setProducer("Opstalia PDF Packet Lab with pdf-lib");
    derivative.setCreationDate(new Date());
    const output = await derivative.save({ useObjectStreams: true, addDefaultPage: false });
    const derivativeSha256 = await sha256(output);
    const outputBuffer = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength);
    self.postMessage(
      { id: request.id, ok: true, output: outputBuffer, sourceSha256, derivativeSha256 },
      { transfer: [outputBuffer] }
    );
  } catch (error) {
    self.postMessage({
      id: request.id,
      ok: false,
      message: error instanceof Error ? error.message : "Unable to create the research derivative."
    });
  }
};

export {};
