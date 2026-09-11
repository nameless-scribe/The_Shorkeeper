import { listIndexedDocuments, loadAllDocumentEmbeddings, type DocumentInfo } from './documents';
import { deserializeEmbedding } from './vector';

export interface CachedDocEmbedding {
  id: string;
  filename: string;
  summary: string | null;
  embedding: Float32Array;
}

let cache: CachedDocEmbedding[] | null = null;

export function invalidateDocCache(): void {
  cache = null;
}

export function getCachedDocEmbeddings(): CachedDocEmbedding[] {
  if (cache === null) {
    cache = loadAllDocumentEmbeddings().map((row) => ({
      id: row.id,
      filename: row.filename,
      summary: row.summary,
      embedding: deserializeEmbedding(row.embedding),
    }));
  }
  return cache;
}

export function getDocumentCount(): number {
  return listIndexedDocuments().length;
}

/** @internal test helper */
export function resetDocCacheForTest(): void {
  cache = null;
}

export type { DocumentInfo };
