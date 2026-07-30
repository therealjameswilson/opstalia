export const NDC_HEADERS: string[];

export function findNdcHeaderRowIndex(rows: string[][]): number;

export interface NdcIndexRecord {
  id: string;
  title: string;
  fields: Record<string, string>;
  searchableText: string;
  officialUrl: string;
  recordPageUrl: string;
  releaseStatus: "described_but_not_digitized" | "finding_aid_only";
}

export function buildNdcRecords(
  rows: string[][],
  headerRowIndex: number,
  options: {
    sourceUrl: string;
    sourcePage: string;
    releaseQuarter: string;
  }
): {
  headers: string[];
  records: NdcIndexRecord[];
};
