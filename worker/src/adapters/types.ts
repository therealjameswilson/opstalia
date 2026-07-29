import type {
  NormalizedRecord,
  NormalizedSearchQuery,
  RawSourceRecord,
  SourceHealth,
  SourceSearchResponse
} from "../../../src/core/types";

export interface AdapterContext {
  signal: AbortSignal;
  retrievedAt: string;
}

export interface SourceAdapter<RawRecord = unknown> {
  id: string;
  name: string;
  search(query: NormalizedSearchQuery, context: AdapterContext): Promise<SourceSearchResponse>;
  normalize(rawRecord: RawRecord, query: NormalizedSearchQuery, context: AdapterContext): NormalizedRecord[];
  healthCheck(): Promise<SourceHealth>;
}

export interface AdapterSearchPayload<RawRecord = unknown> {
  rawRecords: RawSourceRecord[];
  records: RawRecord[];
  total: number;
}
