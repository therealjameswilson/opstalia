import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import { MAX_BROWSER_PACKET_BYTES } from "./client";

export interface OpenPdfResult {
  document: PDFDocumentProxy;
  loadingTask: PDFDocumentLoadingTask;
  byteLength: number;
  sha256: string;
}

export interface PageTextInspection {
  text: string;
  annotationCount: number;
  textSuppressedForAnnotations: boolean;
}

export const MAX_EMBEDDED_TEXT_CHARS_PER_PAGE = 50_000;

let pdfJsPromise: Promise<typeof import("pdfjs-dist")> | undefined;

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function pdfJs(): Promise<typeof import("pdfjs-dist")> {
  pdfJsPromise ??= Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url")
  ]).then(([library, worker]) => {
    library.GlobalWorkerOptions.workerSrc = worker.default;
    return library;
  });
  return pdfJsPromise;
}

export async function openOfficialPdf(
  contentUrl: string,
  byteLength: number | null,
  onProgress?: (loaded: number, total?: number) => void,
  onRangeError?: (error: Error) => void,
  signal?: AbortSignal
): Promise<OpenPdfResult> {
  const library = await pdfJs();
  if (byteLength !== null && (!Number.isSafeInteger(byteLength) || byteLength < 5 || byteLength > MAX_BROWSER_PACKET_BYTES)) {
    throw new Error("The PDF relay did not report a safe bounded source length.");
  }
  let source: { buffer: ArrayBuffer; byteLength: number };
  try {
    source = await downloadBoundedPdf(
      contentUrl,
      byteLength,
      "X-Opstalia-Packet-View",
      onProgress,
      signal
    );
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error("The bounded official PDF stream failed.");
    onRangeError?.(error);
    throw error;
  }
  const sha256 = await sha256Hex(source.buffer);
  if (signal?.aborted) throw new DOMException("Packet opening cancelled", "AbortError");
  const loadingTask = library.getDocument({
    data: new Uint8Array(source.buffer),
    disableRange: true,
    disableStream: true,
    disableAutoFetch: true,
    stopAtErrors: true,
    enableXfa: false,
    isEvalSupported: false,
    maxImageSize: 25_000_000,
    useSystemFonts: true,
    verbosity: library.VerbosityLevel.ERRORS
  });
  loadingTask.onProgress = ({ loaded, total }: { loaded: number; total: number }) => onProgress?.(loaded, total || source.byteLength);
  const abortLoading = () => {
    void loadingTask.destroy();
  };
  signal?.addEventListener("abort", abortLoading, { once: true });
  try {
    const document = await loadingTask.promise;
    if (signal?.aborted) {
      await loadingTask.destroy();
      throw new DOMException("Packet opening cancelled", "AbortError");
    }
    return { loadingTask, document, byteLength: source.byteLength, sha256 };
  } catch (cause) {
    await loadingTask.destroy().catch(() => undefined);
    if (signal?.aborted) throw new DOMException("Packet opening cancelled", "AbortError");
    throw cause;
  } finally {
    signal?.removeEventListener("abort", abortLoading);
  }
}

export async function renderOfficialPdfPage(
  document: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  requestedScale = 1.25,
  signal?: AbortSignal
): Promise<void> {
  const library = await pdfJs();
  const page = await document.getPage(pageNumber);
  const base = page.getViewport({ scale: requestedScale });
  const maxPixels = 16_000_000;
  const scale = base.width * base.height > maxPixels
    ? requestedScale * Math.sqrt(maxPixels / (base.width * base.height))
    : requestedScale;
  const viewport = page.getViewport({ scale });
  const scratch = canvas.ownerDocument.createElement("canvas");
  scratch.width = Math.max(1, Math.floor(viewport.width));
  scratch.height = Math.max(1, Math.floor(viewport.height));
  const context = scratch.getContext("2d", { alpha: false });
  if (!context) throw new Error("Canvas rendering is unavailable in this browser.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, scratch.width, scratch.height);
  const renderTask = page.render({
    canvas: scratch,
    canvasContext: context,
    viewport,
    // Include annotation appearance streams in the inert canvas rendering.
    // Omitting them can remove a visual redaction overlay while leaving the
    // covered page content visible. Opstalia never creates an interactive
    // annotation layer, so annotation actions and links remain unavailable.
    annotationMode: library.AnnotationMode.ENABLE
  });
  const cancel = () => renderTask.cancel();
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    await renderTask.promise;
    if (signal?.aborted) throw new DOMException("Page render cancelled", "AbortError");
    canvas.width = scratch.width;
    canvas.height = scratch.height;
    const output = canvas.getContext("2d", { alpha: false });
    if (!output) throw new Error("Canvas rendering is unavailable in this browser.");
    output.drawImage(scratch, 0, 0);
  } catch (cause) {
    if (signal?.aborted) throw new DOMException("Page render cancelled", "AbortError");
    throw cause;
  } finally {
    signal?.removeEventListener("abort", cancel);
    page.cleanup();
  }
}

export async function inspectOfficialPdfPageText(
  document: PDFDocumentProxy,
  pageNumber: number
): Promise<PageTextInspection> {
  const page = await document.getPage(pageNumber);
  try {
    // `display` intentionally omits Invisible/NoView annotations. Those still
    // belong to the page's /Annots array and can cover or otherwise relate to
    // embedded text, so the safety decision must use the unfiltered set.
    const annotations = await page.getAnnotations({ intent: "any" });
    if (annotations.length > 0) {
      return {
        text: "",
        annotationCount: annotations.length,
        textSuppressedForAnnotations: true
      };
    }

    const reader = page.streamTextContent({ includeMarkedContent: false, disableNormalization: false }).getReader();
    let text = "";
    try {
      while (text.length < MAX_EMBEDDED_TEXT_CHARS_PER_PAGE) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const item of value.items) {
          if (!("str" in item) || !item.str) continue;
          const remaining = MAX_EMBEDDED_TEXT_CHARS_PER_PAGE - text.length;
          if (remaining <= 0) break;
          text += `${text ? " " : ""}${item.str.slice(0, remaining)}`;
        }
      }
      if (text.length >= MAX_EMBEDDED_TEXT_CHARS_PER_PAGE) await reader.cancel();
    } finally {
      reader.releaseLock();
    }
    return {
      text: text.replace(/\s+/g, " ").trim().slice(0, MAX_EMBEDDED_TEXT_CHARS_PER_PAGE),
      annotationCount: 0,
      textSuppressedForAnnotations: false
    };
  } finally {
    page.cleanup();
  }
}

export async function extractEmbeddedPageText(
  document: PDFDocumentProxy,
  pageNumber: number
): Promise<string> {
  return (await inspectOfficialPdfPageText(document, pageNumber)).text;
}

export async function downloadBoundedSourcePdf(
  contentUrl: string,
  expectedLength: number,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal
): Promise<ArrayBuffer> {
  return (await downloadBoundedPdf(
    contentUrl,
    expectedLength,
    "X-Opstalia-Derivative-Export",
    (loaded, total) => onProgress?.(loaded, total ?? expectedLength),
    signal
  )).buffer;
}

async function downloadBoundedPdf(
  contentUrl: string,
  expectedLength: number | null,
  purposeHeader: "X-Opstalia-Packet-View" | "X-Opstalia-Derivative-Export",
  onProgress?: (loaded: number, total?: number) => void,
  signal?: AbortSignal
): Promise<{ buffer: ArrayBuffer; byteLength: number }> {
  if (expectedLength !== null && (!Number.isSafeInteger(expectedLength) || expectedLength < 5 || expectedLength > MAX_BROWSER_PACKET_BYTES)) {
    throw new Error(`The browser workspace accepts official PDFs no larger than ${Math.floor(MAX_BROWSER_PACKET_BYTES / 1024 / 1024)} MB.`);
  }
  const response = await fetch(contentUrl, {
    cache: "no-store",
    credentials: "omit",
    signal,
    headers: { [purposeHeader]: "1" }
  });
  if (response.status !== 200 || !response.body) throw new Error(`Unable to download the official source (${response.status}).`);
  const declaredHeader = response.headers.get("Content-Length");
  const declared = declaredHeader === null ? undefined : Number(declaredHeader);
  if (declared !== undefined && (
    !Number.isSafeInteger(declared) ||
    declared < 5 ||
    declared > MAX_BROWSER_PACKET_BYTES ||
    (expectedLength !== null && declared !== expectedLength)
  )) {
    await response.body.cancel();
    throw new Error("The source file exceeds the bounded browser-export limit or did not report a safe size.");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_BROWSER_PACKET_BYTES) {
      await reader.cancel();
      throw new Error("The source exceeded the bounded browser-export limit while downloading.");
    }
    chunks.push(value);
    onProgress?.(received, declared ?? expectedLength ?? undefined);
  }
  const knownLength = declared ?? expectedLength ?? undefined;
  if (received < 5 || (knownLength !== undefined && received !== knownLength)) {
    throw new Error("The official source download was truncated or changed during transfer.");
  }
  const output = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (new TextDecoder().decode(output.subarray(0, 5)) !== "%PDF-") {
    throw new Error("The official response did not contain a PDF signature.");
  }
  return { buffer: output.buffer, byteLength: received };
}

export interface DerivativeRangeRequest {
  segmentId: string;
  startPage: number;
  endPage: number;
  title: string;
  provenance: string;
}

export interface BatchDerivativeOutput {
  segmentId: string;
  output: ArrayBuffer;
  derivativeSha256: string;
  pageCount: number;
}

export async function createBatchDerivativesInWorker(input: {
  sourceBytes: ArrayBuffer;
  expectedSourceSha256: string;
  ranges: DerivativeRangeRequest[];
  signal?: AbortSignal;
}): Promise<{ outputs: BatchDerivativeOutput[]; sourceSha256: string }> {
  const worker = new Worker(new URL("./processor.worker.ts", import.meta.url), { type: "module" });
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      window.clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abort);
      worker.terminate();
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const abort = () => fail(new DOMException("Derivative export cancelled", "AbortError"));
    const timeout = window.setTimeout(
      () => fail(new Error("The isolated PDF processor exceeded its five-minute safety limit.")),
      300_000
    );
    if (input.signal?.aborted) {
      fail(new DOMException("Derivative export cancelled", "AbortError"));
      return;
    }
    input.signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<{
      id: string;
      ok: boolean;
      outputs?: BatchDerivativeOutput[];
      sourceSha256?: string;
      message?: string;
    }>) => {
      if (event.data.id !== id) return;
      if (
        !event.data.ok ||
        !event.data.outputs ||
        event.data.outputs.length !== input.ranges.length ||
        !event.data.sourceSha256
      ) {
        fail(new Error(event.data.message ?? "Unable to create the research derivative."));
        return;
      }
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        outputs: event.data.outputs,
        sourceSha256: event.data.sourceSha256
      });
    };
    worker.onerror = () => {
      fail(new Error("The isolated PDF processor stopped unexpectedly."));
    };
    const { signal: _signal, ...request } = input;
    worker.postMessage({ id, ...request }, [input.sourceBytes]);
  });
}

export async function createDerivativeInWorker(input: {
  sourceBytes: ArrayBuffer;
  expectedSourceSha256: string;
  segmentId: string;
  startPage: number;
  endPage: number;
  title: string;
  provenance: string;
  signal?: AbortSignal;
}): Promise<{ output: ArrayBuffer; sourceSha256: string; derivativeSha256: string }> {
  const { sourceBytes, expectedSourceSha256, signal, ...range } = input;
  const result = await createBatchDerivativesInWorker({
    sourceBytes,
    expectedSourceSha256,
    ranges: [range],
    signal
  });
  const output = result.outputs[0];
  if (!output) throw new Error("The isolated PDF processor returned no derivative.");
  return {
    output: output.output,
    sourceSha256: result.sourceSha256,
    derivativeSha256: output.derivativeSha256
  };
}
