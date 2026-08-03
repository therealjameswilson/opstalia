import { z } from "zod";

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "");

export const MAX_BROWSER_DERIVATIVE_SOURCE_BYTES = 100 * 1024 * 1024;
export const MAX_BROWSER_PACKET_BYTES = MAX_BROWSER_DERIVATIVE_SOURCE_BYTES;

const contentPathSchema = z.string().max(16_000).regex(
  /^\/api\/pdf\/content\?token=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
  "The PDF relay returned an invalid content path."
);

const sessionSchema = z.object({
  contentUrl: contentPathSchema,
  expiresAt: z.string().max(80),
  byteLength: z.number().int().positive().max(MAX_BROWSER_PACKET_BYTES).nullable(),
  maxByteLength: z.literal(MAX_BROWSER_PACKET_BYTES),
  etag: z.string().max(500).optional(),
  lastModified: z.string().max(200).optional(),
  acceptRanges: z.literal(false),
  deliveryMode: z.literal("bounded_full_file")
});

export interface PdfSessionRequest {
  sourceId: "presidential-libraries";
  naraNaid: string;
  officialRecordUrl: string;
  officialPdfUrl: string;
  acknowledgedPublicUnclassified: true;
}

export interface PdfSession {
  contentUrl: string;
  expiresAt: string;
  byteLength: number | null;
  maxByteLength: number;
  etag?: string;
  lastModified?: string;
  acceptRanges: false;
  deliveryMode: "bounded_full_file";
}

export function packetApiConfigured(): boolean {
  return Boolean(API_BASE);
}

export function resolvePdfContentUrl(contentPath: string, apiBase: string): string {
  const approvedPath = contentPathSchema.parse(contentPath);
  const base = new URL(apiBase);
  const resolved = new URL(approvedPath, base);
  if (resolved.origin !== base.origin || resolved.pathname !== "/api/pdf/content") {
    throw new Error("The PDF relay returned a content URL outside its approved origin.");
  }
  return resolved.href;
}

export async function createPdfSession(
  request: PdfSessionRequest,
  signal?: AbortSignal
): Promise<PdfSession> {
  if (!API_BASE) {
    throw new Error("The production PDF relay is not configured. Set VITE_API_BASE to the deployed Opstalia Worker.");
  }
  const response = await fetch(`${API_BASE}/api/pdf/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    cache: "no-store",
    credentials: "omit",
    signal
  });
  const body = await response.json().catch(() => ({ message: `PDF relay returned ${response.status}` }));
  if (!response.ok) {
    throw new Error(String((body as { message?: string }).message ?? "The official packet could not be opened."));
  }
  const session = sessionSchema.parse(body);
  return { ...session, contentUrl: resolvePdfContentUrl(session.contentUrl, API_BASE) };
}
