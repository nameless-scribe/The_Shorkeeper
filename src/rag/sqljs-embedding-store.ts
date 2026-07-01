import { getCachedChunkEmbeddings } from './chunk-cache';
import type { EmbeddingRecord, EmbeddingStore } from './embedding-store';
import { topKBySimilarity } from './vector';

export class SqlJsEmbeddingStore implements EmbeddingStore {
  async upsert(_id: string, _content: string, _embedding: Float32Array): Promise<void> {
    // Chunk writes go through documents.ts; store is read-optimized for retrieval.
  }

  async search(query: Float32Array, limit: number): Promise<EmbeddingRecord[]> {
    const stored = getCachedChunkEmbeddings();
    const hits = topKBySimilarity(
      query,
      stored.map((s) => ({ data: s, embedding: s.embedding })),
      limit,
    );
    return hits.map((h) => ({
      id: h.item.id,
      content: h.item.content,
      embedding: h.item.embedding,
    }));
  }

  async delete(_id: string): Promise<void> {
    // Deletion handled by documents.ts
  }
}
