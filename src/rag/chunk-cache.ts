import { loadAllChunkEmbeddings } from './documents';

export interface CachedChunkEmbedding {
  id: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  filename: string;
  embedding: Float32Array;
}

let cache: CachedChunkEmbedding[] | null = null;

export function invalidateChunkCache(): void {
  cache = null;
}

export function getCachedChunkEmbeddings(): CachedChunkEmbedding[] {
  if (cache === null) {
    cache = loadAllChunkEmbeddings();
  }
  return cache;
}

/** @internal test helper */
export function resetChunkCacheForTest(): void {
  cache = null;
}
