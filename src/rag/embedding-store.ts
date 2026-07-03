export interface EmbeddingSearchFilter {
  documentIds?: string[];
}

export interface EmbeddingRecord {
  id: string;
  content: string;
  embedding: Float32Array;
}

export interface EmbeddingStore {
  upsert(id: string, content: string, embedding: Float32Array): Promise<void>;
  search(
    query: Float32Array,
    limit: number,
    filter?: EmbeddingSearchFilter,
  ): Promise<EmbeddingRecord[]>;
  delete(id: string): Promise<void>;
}
