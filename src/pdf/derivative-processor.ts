import { PDFArray, PDFDocument, PDFName } from "pdf-lib";

export interface DerivativeProcessorRange {
  segmentId: string;
  startPage: number;
  endPage: number;
  title: string;
  provenance: string;
}

export interface DerivativeProcessorRequest {
  sourceBytes: ArrayBuffer;
  expectedSourceSha256: string;
  ranges: DerivativeProcessorRange[];
}

export interface DerivativeProcessorOutput {
  segmentId: string;
  output: ArrayBuffer;
  derivativeSha256: string;
  pageCount: number;
}

export interface DerivativeProcessorResult {
  outputs: DerivativeProcessorOutput[];
  sourceSha256: string;
}

export const MAX_DERIVATIVES = 200;
export const MAX_SELECTED_PAGES = 5_000;
export const MAX_TOTAL_OUTPUT_BYTES = 200 * 1024 * 1024;

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validateRequestShape(request: DerivativeProcessorRequest): number {
  if (!/^[a-f0-9]{64}$/i.test(request.expectedSourceSha256)) {
    throw new Error("A valid reviewed source SHA-256 is required for derivative export.");
  }
  if (!Array.isArray(request.ranges) || request.ranges.length < 1 || request.ranges.length > MAX_DERIVATIVES) {
    throw new Error(`A batch must contain between 1 and ${MAX_DERIVATIVES} confirmed page ranges.`);
  }
  const ids = new Set<string>();
  let selectedPages = 0;
  for (const range of request.ranges) {
    if (
      !range.segmentId ||
      range.segmentId.length > 150 ||
      ids.has(range.segmentId) ||
      !Number.isInteger(range.startPage) ||
      !Number.isInteger(range.endPage) ||
      range.startPage < 1 ||
      range.endPage < range.startPage ||
      !range.title ||
      range.title.length > 500 ||
      range.provenance.length > 10_000
    ) {
      throw new Error("The derivative batch contains an invalid or duplicate range request.");
    }
    ids.add(range.segmentId);
    selectedPages += range.endPage - range.startPage + 1;
  }
  if (!Number.isSafeInteger(selectedPages) || selectedPages < 1 || selectedPages > MAX_SELECTED_PAGES) {
    throw new Error(`A batch may contain at most ${MAX_SELECTED_PAGES.toLocaleString()} selected PDF pages.`);
  }
  return selectedPages;
}

export async function processDerivativeBatch(
  request: DerivativeProcessorRequest
): Promise<DerivativeProcessorResult> {
  validateRequestShape(request);
  const source = new Uint8Array(request.sourceBytes);
  const sourceSha256 = await sha256(source);
  if (sourceSha256 !== request.expectedSourceSha256.toLocaleLowerCase()) {
    throw new Error("The official source hash changed after review. Reopen the packet before exporting derivatives.");
  }
  const original = await PDFDocument.load(source, {
    ignoreEncryption: false,
    updateMetadata: false,
    throwOnInvalidObject: true
  });
  const pageCount = original.getPageCount();
  const selectedPageIndices = new Set<number>();
  for (const range of request.ranges) {
    if (range.endPage > pageCount) {
      throw new Error("A requested page range is outside the source PDF.");
    }
    for (let index = range.startPage - 1; index < range.endPage; index += 1) {
      selectedPageIndices.add(index);
    }
  }
  for (const index of selectedPageIndices) {
    const annotations = original.getPage(index).node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (annotations && annotations.size() > 0) {
      throw new Error(
        `PDF page ${index + 1} contains annotations. Opstalia blocks derivative export because removing a covering annotation could reveal underlying text.`
      );
    }
  }

  const outputs: DerivativeProcessorOutput[] = [];
  let totalOutputBytes = 0;
  for (const range of request.ranges) {
    const indices = Array.from(
      { length: range.endPage - range.startPage + 1 },
      (_, index) => range.startPage - 1 + index
    );
    const derivative = await PDFDocument.create();
    const pages = await derivative.copyPages(original, indices);
    for (const page of pages) {
      page.node.delete(PDFName.of("AA"));
      // The preflight above proved every selected source /Annots array empty.
      page.node.delete(PDFName.of("Annots"));
      derivative.addPage(page);
    }
    derivative.setTitle(range.title);
    derivative.setSubject(`Research derivative. Annotation-bearing pages are refused and active page actions are removed. ${range.provenance}`);
    derivative.setCreator("Opstalia PDF Packet Lab");
    derivative.setProducer("Opstalia PDF Packet Lab with pdf-lib");
    derivative.setCreationDate(new Date());
    const output = await derivative.save({ useObjectStreams: true, addDefaultPage: false });
    totalOutputBytes += output.byteLength;
    if (totalOutputBytes > MAX_TOTAL_OUTPUT_BYTES) {
      throw new Error("The derivative outputs exceed the 200 MB browser-package safety limit. Export fewer ranges at a time.");
    }
    outputs.push({
      segmentId: range.segmentId,
      output: Uint8Array.from(output).buffer,
      derivativeSha256: await sha256(output),
      pageCount: indices.length
    });
  }
  return { outputs, sourceSha256 };
}
