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
let cacheVersion = 0;

export function invalidateChunkCache(): void {
  cache = null;
  cacheVersion += 1;
}

export function getChunkCacheVersion(): number {
  return cacheVersion;
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
  cacheVersion = 0;
}
