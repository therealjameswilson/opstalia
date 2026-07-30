export interface Jfk2025BatchSummary {
  label: string;
  pdfCount: number;
}

export type Jfk2025ReleaseStatus = "not_determined";

export interface Jfk2025IndexRecord {
  id: string;
  fileName: string;
  rifNumber: string;
  fileVariant: string;
  sourceReportedRowDate: string;
  officialUrl: string;
  sourceHref: string;
  recordPageUrl: string;
  rowIndex: number;
  searchableText: string;
  releaseStatus: Jfk2025ReleaseStatus;
  releaseDeterminationBasis: string;
}

export declare const JFK_2025_SOURCE_PAGE: string;
export declare const JFK_2025_PARSER_VERSION: string;
export declare const JFK_2025_HEADERS: string[];

export declare function decodeHtml(value?: string): string;
export declare function normalizeOfficialJfkPdfUrl(
  href: string,
  sourcePage?: string
): { officialUrl: string; fileName: string };
export declare function parseJfk2025ReleasePage(
  html: string,
  options?: {
    sourcePage?: string;
    minimumRecords?: number;
    maximumRecords?: number;
  }
): {
  batchSummary: Jfk2025BatchSummary[];
  declaredPdfTotal: number;
  distinctRifCount: number;
  records: Jfk2025IndexRecord[];
};
