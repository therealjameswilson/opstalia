import { z } from "zod";
import type { SourceDefinition } from "../../../src/core/types";
import { pdfPacketSessionRequestSchema } from "../../../src/core/validation";
import { validateNaraPresidentialLibraryPacket } from "../../../src/security/url-policy";

const MAX_PACKET_BYTES = 100 * 1024 * 1024;
const MAX_BROWSER_EXPORT_BYTES = MAX_PACKET_BYTES;
const TOKEN_TTL_SECONDS = 2 * 60 * 60;

const tokenPayloadSchema = z.object({
  version: z.literal(1),
  sourceId: z.literal("presidential-libraries"),
  naraNaid: z.string().regex(/^\d{1,20}$/),
  officialPdfUrl: z.string().url().max(4096),
  officialRecordUrl: z.string().url().max(4096),
  byteLength: z.number().int().positive().max(MAX_PACKET_BYTES).optional(),
  etag: z.string().max(500).optional(),
  lastModified: z.string().max(200).optional(),
  expiresAt: z.number().int().positive()
});

type TokenPayload = z.infer<typeof tokenPayloadSchema>;

export class PdfRelayError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
  }
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 12_000) {
    throw new PdfRelayError("Invalid document-access token.", 401, "PDF_TOKEN_INVALID");
  }
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new PdfRelayError("Invalid document-access token.", 401, "PDF_TOKEN_INVALID");
  }
  const decoded = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (base64UrlEncode(decoded) !== value) {
    throw new PdfRelayError("Invalid document-access token.", 401, "PDF_TOKEN_INVALID");
  }
  return decoded;
}

async function hmac(value: string, secret: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

async function createToken(payload: TokenPayload, secret: string): Promise<string> {
  const encoded = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  return `${encoded}.${base64UrlEncode(await hmac(encoded, secret))}`;
}

function timingSafeBytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  const length = Math.max(left.byteLength, right.byteLength);
  let difference = left.byteLength ^ right.byteLength;
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

async function verifyToken(token: string, secret: string): Promise<TokenPayload> {
  const [encoded, providedSignature, extra] = token.split(".");
  if (!encoded || !providedSignature || extra) {
    throw new PdfRelayError("Invalid document-access token.", 401, "PDF_TOKEN_INVALID");
  }
  const provided = base64UrlDecode(providedSignature);
  const expected = await hmac(encoded, secret);
  if (!timingSafeBytesEqual(provided, expected)) {
    throw new PdfRelayError("Invalid document-access token.", 401, "PDF_TOKEN_INVALID");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder().decode(base64UrlDecode(encoded)));
  } catch {
    throw new PdfRelayError("Invalid document-access token.", 401, "PDF_TOKEN_INVALID");
  }
  const payload = tokenPayloadSchema.safeParse(decoded);
  if (!payload.success) throw new PdfRelayError("Invalid document-access token.", 401, "PDF_TOKEN_INVALID");
  if (payload.data.expiresAt < Math.floor(Date.now() / 1000)) {
    throw new PdfRelayError("The document-access token expired. Reopen the official packet.", 401, "PDF_TOKEN_EXPIRED");
  }
  return payload.data;
}

function requireRelaySecret(secret?: string): string {
  if (!secret || secret.length < 16) {
    throw new PdfRelayError(
      "The PDF relay is not ready. Configure RATE_LIMIT_SALT as a Worker secret.",
      503,
      "PDF_RELAY_NOT_READY"
    );
  }
  return secret;
}

function isPdfContentType(value: string | null): boolean {
  const mediaType = value?.split(";", 1)[0].trim().toLocaleLowerCase();
  return mediaType === "application/pdf" || mediaType === "application/octet-stream";
}

async function fetchNoRedirect(url: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Accept-Encoding", "identity");
  const outboundInit: RequestInit = {
    ...init,
    headers,
    redirect: "manual",
    cache: "no-store"
  };
  const response = await fetch(url, outboundInit);
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new PdfRelayError("The official PDF redirected outside its validated locator.", 502, "PDF_REDIRECT_REJECTED");
  }
  return response;
}

async function probeOfficialPdf(
  officialPdfUrl: string,
  signal: AbortSignal
): Promise<{ byteLength?: number; etag?: string; lastModified?: string }> {
  const head = await fetchNoRedirect(officialPdfUrl, {
    method: "HEAD",
    headers: { Accept: "application/pdf" },
    signal
  });
  if (!head.ok || !isPdfContentType(head.headers.get("Content-Type"))) {
    await head.body?.cancel();
    throw new PdfRelayError("The official locator did not return a supported PDF.", 422, "PDF_UPSTREAM_INVALID");
  }
  const headLengthHeader = head.headers.get("Content-Length");
  const reportedHeadLength = headLengthHeader === null ? undefined : Number(headLengthHeader);
  if (reportedHeadLength !== undefined && (
    !Number.isSafeInteger(reportedHeadLength) ||
    reportedHeadLength < 0 ||
    reportedHeadLength > MAX_PACKET_BYTES
  )) {
    await head.body?.cancel();
    throw new PdfRelayError("The official PDF exceeds the 100 MB browser-workspace limit or did not report a safe size.", 413, "PDF_TOO_LARGE");
  }
  const headEtag = head.headers.get("ETag") ?? undefined;
  const headLastModified = head.headers.get("Last-Modified") ?? undefined;
  await head.body?.cancel();

  const signature = await fetchNoRedirect(officialPdfUrl, {
    method: "GET",
    headers: { Accept: "application/pdf" },
    signal
  });
  if (signature.status !== 200) {
    await signature.body?.cancel();
    throw new PdfRelayError("The official host did not return the validated PDF for signature inspection.", 502, "PDF_PROBE_STATUS_INVALID");
  }
  if (!isPdfContentType(signature.headers.get("Content-Type"))) {
    await signature.body?.cancel();
    throw new PdfRelayError("The official response did not identify a supported PDF type.", 502, "PDF_PROBE_TYPE_INVALID");
  }
  const signatureLengthHeader = signature.headers.get("Content-Length");
  const signatureLength = signatureLengthHeader === null ? undefined : Number(signatureLengthHeader);
  if (signatureLength !== undefined && (
    !Number.isSafeInteger(signatureLength) ||
    signatureLength < 0 ||
    signatureLength > MAX_PACKET_BYTES
  )) {
    await signature.body?.cancel();
    throw new PdfRelayError("The official PDF exceeds the 100 MB browser-workspace limit or reported a conflicting size.", 413, "PDF_TOO_LARGE");
  }
  const signatureEtag = signature.headers.get("ETag") ?? undefined;
  const signatureLastModified = signature.headers.get("Last-Modified") ?? undefined;
  if (
    (headEtag && signatureEtag !== headEtag) ||
    (!headEtag && headLastModified && signatureLastModified !== headLastModified)
  ) {
    await signature.body?.cancel();
    throw new PdfRelayError("The official source changed during admission. Reopen the packet and try again.", 409, "PDF_SOURCE_CHANGED");
  }
  if (!signature.body) {
    throw new PdfRelayError("The official response did not include PDF bytes.", 502, "PDF_BODY_MISSING");
  }
  const reader = signature.body.getReader();
  const prefix = new Uint8Array(5);
  let prefixLength = 0;
  try {
    while (prefixLength < prefix.byteLength) {
      const { done, value } = await reader.read();
      if (done) break;
      const take = Math.min(value.byteLength, prefix.byteLength - prefixLength);
      prefix.set(value.subarray(0, take), prefixLength);
      prefixLength += take;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  if (prefixLength !== prefix.byteLength || new TextDecoder().decode(prefix) !== "%PDF-") {
    throw new PdfRelayError("The official response did not contain a PDF signature.", 422, "PDF_SIGNATURE_INVALID");
  }
  return {
    etag: signatureEtag ?? headEtag,
    lastModified: signatureLastModified ?? headLastModified
  };
}

function boundedLengthStream(body: ReadableStream<Uint8Array>, expectedLength?: number): ReadableStream<Uint8Array> {
  let received = 0;
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > MAX_PACKET_BYTES || (expectedLength !== undefined && received > expectedLength)) {
        throw new Error("The official PDF stream exceeded the bounded browser-workspace limit.");
      }
      controller.enqueue(chunk);
    },
    flush() {
      if (expectedLength !== undefined && received !== expectedLength) {
        throw new Error("The official PDF stream ended before its validated byte length.");
      }
    }
  }));
}

export async function createPresidentialLibraryPdfSession(input: {
  body: unknown;
  source: SourceDefinition | undefined;
  secret?: string;
  signal: AbortSignal;
}): Promise<{
  contentUrl: string;
  expiresAt: string;
  byteLength: number | null;
  maxByteLength: number;
  etag?: string;
  lastModified?: string;
  acceptRanges: false;
  deliveryMode: "bounded_full_file";
}> {
  const secret = requireRelaySecret(input.secret);
  const request = pdfPacketSessionRequestSchema.parse(input.body);
  if (!input.source) throw new PdfRelayError("The presidential-library source is not registered.", 500, "PDF_SOURCE_MISSING");
  const admission = validateNaraPresidentialLibraryPacket(request, input.source);
  if (!admission.allowed || !admission.canonicalPdfUrl || !admission.canonicalRecordUrl) {
    throw new PdfRelayError(admission.reason, 400, "PDF_SOURCE_REJECTED");
  }
  const metadata = await probeOfficialPdf(admission.canonicalPdfUrl, input.signal);
  const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const payload: TokenPayload = {
    version: 1,
    sourceId: "presidential-libraries",
    naraNaid: request.naraNaid,
    officialPdfUrl: admission.canonicalPdfUrl,
    officialRecordUrl: admission.canonicalRecordUrl,
    ...(metadata.byteLength === undefined ? {} : { byteLength: metadata.byteLength }),
    etag: metadata.etag,
    lastModified: metadata.lastModified,
    expiresAt
  };
  return {
    contentUrl: `/api/pdf/content?token=${encodeURIComponent(await createToken(payload, secret))}`,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
    byteLength: metadata.byteLength ?? null,
    maxByteLength: MAX_PACKET_BYTES,
    etag: metadata.etag,
    lastModified: metadata.lastModified,
    acceptRanges: false,
    deliveryMode: "bounded_full_file"
  };
}

export async function relayPresidentialLibraryPdf(input: {
  request: Request;
  token: string;
  secret?: string;
  signal: AbortSignal;
  responseHeaders: Headers;
}): Promise<Response> {
  const payload = await verifyToken(input.token, requireRelaySecret(input.secret));
  if (input.request.headers.has("Range")) {
    throw new PdfRelayError("This relay uses one bounded full-file browser stream and does not accept byte-range requests.", 416, "PDF_RANGE_REJECTED");
  }
  const fullExport = input.request.headers.get("X-Opstalia-Derivative-Export") === "1";
  const packetView = input.request.headers.get("X-Opstalia-Packet-View") === "1";
  if (fullExport === packetView || (payload.byteLength !== undefined && payload.byteLength > MAX_BROWSER_EXPORT_BYTES)) {
    throw new PdfRelayError(
      "Select exactly one bounded browser purpose. Viewing and derivative export are limited to official PDFs no larger than 100 MB.",
      416,
      "PDF_PURPOSE_REQUIRED"
    );
  }
  const headers = new Headers({ Accept: "application/pdf" });
  const upstream = await fetchNoRedirect(payload.officialPdfUrl, {
    method: "GET",
    headers,
    signal: input.signal
  });
  if (upstream.status !== 200 || !isPdfContentType(upstream.headers.get("Content-Type"))) {
    await upstream.body?.cancel();
    throw new PdfRelayError("The official host returned an inconsistent PDF response.", 502, "PDF_UPSTREAM_INVALID");
  }
  const reportedLength = upstream.headers.get("Content-Length");
  const declaredLength = reportedLength === null ? undefined : Number(reportedLength);
  if (
    !upstream.body ||
    (declaredLength !== undefined && (
      !Number.isSafeInteger(declaredLength) ||
      declaredLength < 0 ||
      declaredLength > MAX_PACKET_BYTES
    ))
  ) {
    await upstream.body?.cancel();
    throw new PdfRelayError("The official host returned an unbounded or inconsistent PDF length.", 502, "PDF_LENGTH_INVALID");
  }
  if (
    (payload.etag && upstream.headers.get("ETag") !== payload.etag) ||
    (!payload.etag && payload.lastModified && upstream.headers.get("Last-Modified") !== payload.lastModified)
  ) {
    await upstream.body.cancel();
    throw new PdfRelayError("The official source changed after this packet session opened. Reopen the packet before continuing.", 409, "PDF_SOURCE_CHANGED");
  }
  const outputHeaders = new Headers(input.responseHeaders);
  for (const name of ["Content-Type", "ETag", "Last-Modified"]) {
    const value = upstream.headers.get(name);
    if (value) outputHeaders.set(name, value);
  }
  outputHeaders.set("Accept-Ranges", "none");
  outputHeaders.set("Content-Disposition", "inline");
  outputHeaders.set("X-Opstalia-Source", "nara-presidential-library-packet");
  const expectedLength = declaredLength !== undefined && declaredLength >= 5 ? declaredLength : undefined;
  return new Response(boundedLengthStream(upstream.body, expectedLength), { status: upstream.status, headers: outputHeaders });
}
