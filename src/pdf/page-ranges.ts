export interface PageRange {
  startPage: number;
  endPage: number;
}

export function validatePageRange(
  startPage: number,
  endPage: number,
  pageCount: number
): { valid: boolean; reason: string } {
  if (![startPage, endPage, pageCount].every(Number.isInteger)) {
    return { valid: false, reason: "Page numbers must be whole numbers." };
  }
  if (pageCount < 1 || startPage < 1 || endPage < 1) {
    return { valid: false, reason: "Page numbers begin at 1." };
  }
  if (startPage > endPage) {
    return { valid: false, reason: "The end page cannot precede the start page." };
  }
  if (endPage > pageCount) {
    return { valid: false, reason: `The source PDF has ${pageCount} pages.` };
  }
  return { valid: true, reason: "Valid page range" };
}

export function rangesOverlap(left: PageRange, right: PageRange): boolean {
  return left.startPage <= right.endPage && right.startPage <= left.endPage;
}

export function mergePageRanges(ranges: PageRange[]): PageRange[] {
  const ordered = ranges
    .map((range) => ({ ...range }))
    .sort((left, right) => left.startPage - right.startPage || left.endPage - right.endPage);
  const merged: PageRange[] = [];
  for (const range of ordered) {
    const previous = merged.at(-1);
    if (!previous || range.startPage > previous.endPage + 1) {
      merged.push(range);
    } else {
      previous.endPage = Math.max(previous.endPage, range.endPage);
    }
  }
  return merged;
}

export function splitPageRange(range: PageRange, beforePage: number): PageRange[] {
  if (!Number.isInteger(beforePage) || beforePage <= range.startPage || beforePage > range.endPage) {
    return [range];
  }
  return [
    { startPage: range.startPage, endPage: beforePage - 1 },
    { startPage: beforePage, endPage: range.endPage }
  ];
}

export function pageRangeLabel(range: PageRange): string {
  return range.startPage === range.endPage
    ? `PDF page ${range.startPage}`
    : `PDF pages ${range.startPage}–${range.endPage}`;
}
