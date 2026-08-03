import type { PdfPacketSegment, ReleaseDetermination } from "../core/types";

export interface PacketPageText {
  pageNumber: number;
  text: string;
}

interface BoundarySignal {
  pageNumber: number;
  kind: "page_range" | "described_item";
  title: string;
  confidence: number;
  reasons: string[];
  describedExtent?: number;
}

function normalized(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[|]/g, "I")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function firstSubject(text: string): string | undefined {
  return normalized(text).match(/\bSUBJECT\s*[:-]\s*([^\n]{4,140})/i)?.[1]?.trim();
}

function titleFor(text: string, fallback: string): string {
  const subject = firstSubject(text);
  return subject ? `${fallback}: ${subject}` : fallback;
}

function signalForPage(page: PacketPageText): BoundarySignal | undefined {
  const text = normalized(page.text);
  if (!text) return undefined;
  if (/WITHDRAWAL\s*\/\s*REDACTION\s+SHEET/i.test(text)) {
    const extent = Number(text.match(/\((\d{1,4})\s+pp?\.\)/i)?.[1] ?? 0) || undefined;
    return {
      pageNumber: page.pageNumber,
      kind: "described_item",
      title: "Item described on a withdrawal/redaction sheet",
      confidence: 0.82,
      reasons: [
        "Visible withdrawal/redaction-sheet heading",
        "The sheet is evidence of an item description, not proof that the underlying pages follow"
      ],
      describedExtent: extent
    };
  }

  const reasons: string[] = [];
  let score = 0;
  let fallback = "Proposed document boundary";
  if (/MEMORANDUM\s+OF\s+TELEPHONE\s+CONVERSATION/i.test(text)) {
    score += 0.58;
    fallback = "Memorandum of telephone conversation";
    reasons.push("Memorandum of telephone conversation heading");
  } else if (/MEMORANDUM\s+OF\s+CONVERSATION/i.test(text)) {
    score += 0.58;
    fallback = "Memorandum of conversation";
    reasons.push("Memorandum of conversation heading");
  } else if (/\b(?:MEMCON|TELCON)\b/i.test(text)) {
    score += 0.42;
    fallback = /TELCON/i.test(text) ? "Telephone conversation" : "Meeting memorandum";
    reasons.push("Memcon or telcon label");
  } else if (/\bMEMORANDUM\s+(?:FOR|TO)\b/i.test(text) && /\bSUBJECT\s*[:-]/i.test(text)) {
    score += 0.5;
    fallback = "Memorandum";
    reasons.push("Memorandum addressee and subject fields");
  }
  if (/\bSUBJECT\s*[:-]/i.test(text)) {
    score += 0.16;
    reasons.push("Subject field");
  }
  if (/\bPARTICIPANTS?\s*[:-]/i.test(text)) {
    score += 0.14;
    reasons.push("Participant field");
  }
  if (/\b(?:19|20)\d{2}\b/.test(text) && /\b(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)/i.test(text)) {
    score += 0.07;
    reasons.push("Visible month and year");
  }
  if (score < 0.5) return undefined;
  return {
    pageNumber: page.pageNumber,
    kind: "page_range",
    title: titleFor(page.text, fallback),
    confidence: Math.min(0.95, score),
    reasons
  };
}

function cautiousStatus(kind: BoundarySignal["kind"]): ReleaseDetermination {
  return kind === "described_item"
    ? {
        status: "withdrawal_notice_only",
        determinationBasis: "A withdrawal/redaction sheet appears in the official packet; the underlying item pages have not been identified.",
        source: "Opstalia deterministic packet detector",
        confidence: 0.65,
        humanReview: true
      }
    : {
        status: "not_determined",
        determinationBasis: "Page presence in a public packet does not establish full release, declassification, or completeness.",
        source: "Opstalia cautious default",
        confidence: 1,
        humanReview: true
      };
}

export function proposePacketSegments(
  pages: PacketPageText[],
  pageCount: number,
  now = new Date().toISOString()
): PdfPacketSegment[] {
  const ordered = pages
    .filter((page) => page.pageNumber >= 1 && page.pageNumber <= pageCount)
    .sort((left, right) => left.pageNumber - right.pageNumber);
  const signals = ordered.map(signalForPage).filter((signal): signal is BoundarySignal => Boolean(signal));
  const physical = signals.filter((signal) => signal.kind === "page_range");
  return signals.map((signal, index) => {
    const nextStart = physical.find((candidate) => candidate.pageNumber > signal.pageNumber)?.pageNumber;
    const endMarker = signal.kind === "page_range"
      ? ordered.find(
          (page) =>
            page.pageNumber >= signal.pageNumber &&
            page.pageNumber < (nextStart ?? pageCount + 1) &&
            /\bEND\s+OF\s+(?:THE\s+)?(?:MEETING|CONVERSATION)\b/i.test(normalized(page.text))
        )?.pageNumber
      : undefined;
    const endPage = signal.kind === "page_range"
      ? Math.min(pageCount, endMarker ?? ((nextStart ?? pageCount + 1) - 1))
      : undefined;
    return {
      id: `packet-proposal-${signal.pageNumber}-${index + 1}`,
      kind: signal.kind,
      title: signal.title,
      startPage: signal.kind === "page_range" ? signal.pageNumber : undefined,
      endPage,
      evidencePages: signal.kind === "described_item" ? [signal.pageNumber] : undefined,
      describedExtent: signal.describedExtent,
      releaseStatus: cautiousStatus(signal.kind),
      detectionMethod: "pattern_match",
      confidence: signal.confidence,
      reasons: endMarker ? [...signal.reasons, `End marker on PDF page ${endMarker}`] : signal.reasons,
      reviewStatus: "proposed",
      createdAt: now,
      updatedAt: now
    };
  });
}
