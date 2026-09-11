import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  deleteDocumentData,
  findDocumentByContentHash,
  getAdjacentChunks,
  getChunkSearchRows,
  getDocument,
  getStoredEmbeddingDimensions,
  hasDocumentChunksFts,
  insertDocumentWithChunks as insertDocumentRecords,
  listDocuments,
  loadAllChunkEmbeddingRecords,
  loadAllDocumentEmbeddings,
  loadFtsSourceRows,
  rebuildFtsIndex as rebuildFtsRecords,
  replaceDocumentChunks as replaceDocumentChunkRecords,
  searchDocumentChunkFtsRanks,
  updateDocumentMeta as updateDocumentMetaRecord,
  type DocumentInfo,
  type DocumentMetaPatch,
  type FtsIndexRow,
  type RagChunkInput,
  type ReplaceDocumentChunksMeta,
} from '../db/repositories/rag-documents';
import { invalidateDocCache } from './doc-cache';
import { invalidateChunkCache } from './chunk-cache';
import {
  buildFtsMatchQuery,
  extractSearchTerms,
  searchChunksSparseInMemory,
  type SparseHit,
} from './sparse-search';
import { deserializeEmbedding } from './vector';
import { getKnowledgeDir, resolveKnowledgeFilePath } from './knowledge-path';

export {
  findDocumentByContentHash,
  getAdjacentChunks,
  getDocument,
  getStoredEmbeddingDimensions,
  listDocuments,
  loadAllDocumentEmbeddings,
  loadFtsSourceRows,
  type DocumentInfo,
};

export function computeContentHash(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

export function checkEmbeddingDimensionMismatch(currentDim: number | null): {
  storedDimensions: number[];
  hasMismatch: boolean;
  currentDimension: number | null;
} {
  const storedDimensions = getStoredEmbeddingDimensions();
  if (!currentDim || currentDim <= 0) {
    return {
      storedDimensions,
      hasMismatch: storedDimensions.length > 1,
      currentDimension: null,
    };
  }
  const hasMismatch =
    storedDimensions.length > 1 ||
    (storedDimensions.length === 1 && storedDimensions[0] !== currentDim);
  return { storedDimensions, hasMismatch, currentDimension: currentDim };
}

export function hasFtsTable(): boolean {
  return hasDocumentChunksFts();
}

export type FtsSearchHit = SparseHit & { rank?: number };

function searchChunksFtsNative(
  query: string,
  limit: number,
  documentIds?: string[],
): FtsSearchHit[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const rankByChunkId = new Map<string, number>();
  const tryMatch = (term: string): void => {
    if (!term) return;
    const rows = searchDocumentChunkFtsRanks(term, limit * 2, documentIds);
    if (!rows) return;
    for (const row of rows) {
      const previous = rankByChunkId.get(row.chunkId);
      if (previous == null || row.rank < previous) {
        rankByChunkId.set(row.chunkId, row.rank);
      }
    }
  };

  tryMatch(buildFtsMatchQuery(trimmed));
  if (!rankByChunkId.size) {
    for (const term of extractSearchTerms(trimmed)) {
      tryMatch(buildFtsMatchQuery(term));
    }
  }
  if (!rankByChunkId.size) return [];

  const sortedRanks = [...rankByChunkId.entries()]
    .sort((a, b) => a[1] - b[1])
    .slice(0, limit);
  const rowsById = new Map(
    getChunkSearchRows(sortedRanks.map(([chunkId]) => chunkId)).map((row) => [
      row.chunkId,
      row,
    ]),
  );
  const allowedDocumentIds = documentIds?.length ? new Set(documentIds) : null;
  const results: FtsSearchHit[] = [];

  for (const [chunkId, rank] of sortedRanks) {
    const row = rowsById.get(chunkId);
    if (!row) continue;
    if (allowedDocumentIds && !allowedDocumentIds.has(row.documentId)) continue;
    results.push({
      chunkId: row.chunkId,
      documentId: row.documentId,
      content: row.content,
      filename: row.filename,
      chunkIndex: row.chunkIndex,
      score: -rank,
      rank,
    });
  }
  return results;
}

export function searchChunksFts(
  query: string,
  limit: number,
  documentIds?: string[],
): FtsSearchHit[] {
  let hits: FtsSearchHit[] = [];
  if (hasFtsTable()) {
    hits = searchChunksFtsNative(query, limit, documentIds);
  }
  if (!hits.length) {
    hits = searchChunksSparseInMemory(query, limit * 2);
    if (documentIds?.length) {
      const allowed = new Set(documentIds);
      hits = hits.filter((hit) => allowed.has(hit.documentId));
    }
    hits = hits.slice(0, limit);
  }
  return hits;
}

async function restoreQuarantinedFile(quarantinePath: string, originalPath: string): Promise<void> {
  await fs.rename(quarantinePath, originalPath);
}

export async function deleteDocument(id: string): Promise<boolean> {
  const document = getDocument(id);
  if (!document) return false;

  const absolutePath = resolveKnowledgeFilePath(document.filepath);
  const trashDir = path.join(getKnowledgeDir(), '.trash');
  const quarantinePath = path.join(
    trashDir,
    `${document.id}-${randomUUID()}`,
  );
  let quarantined = false;

  await fs.mkdir(trashDir, { recursive: true });
  try {
    await fs.rename(absolutePath, quarantinePath);
    quarantined = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  try {
    if (!deleteDocumentData(id)) {
      if (quarantined) await restoreQuarantinedFile(quarantinePath, absolutePath);
      return false;
    }
  } catch (error) {
    if (quarantined) {
      try {
        await restoreQuarantinedFile(quarantinePath, absolutePath);
      } catch (restoreError) {
        throw new AggregateError(
          [error, restoreError],
          `文档数据删除失败，且隔离文件无法恢复: ${quarantinePath}`,
        );
      }
    }
    throw error;
  }

  invalidateChunkCache();
  invalidateDocCache();
  if (quarantined) {
    await fs.unlink(quarantinePath).catch((error) => {
      console.warn('[rag] 文档已删除，隔离文件将保留待后续清理:', quarantinePath, error);
    });
  }
  return true;
}

export function insertDocumentWithChunks(input: {
  filename: string;
  filepath: string;
  mimeType: string | null;
  chunks: RagChunkInput[];
  contentHash?: string | null;
  embeddingModel?: string | null;
  embeddingDim?: number | null;
  summary?: string | null;
  outline?: string | null;
  docEmbedding?: Uint8Array | null;
}): DocumentInfo {
  const document = insertDocumentRecords(input);

  invalidateChunkCache();
  invalidateDocCache();
  return document;
}

export function updateDocumentMeta(documentId: string, meta: DocumentMetaPatch): void {
  updateDocumentMetaRecord(documentId, meta);
  invalidateDocCache();
}

export function replaceDocumentChunks(
  documentId: string,
  chunks: RagChunkInput[],
  meta?: ReplaceDocumentChunksMeta,
): void {
  replaceDocumentChunkRecords(documentId, chunks, meta);
  invalidateChunkCache();
  invalidateDocCache();
}

export function loadAllChunkEmbeddings(): Array<{
  id: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  filename: string;
  embedding: Float32Array;
}> {
  return loadAllChunkEmbeddingRecords().map((row) => ({
    ...row,
    embedding: deserializeEmbedding(row.embedding),
  }));
}

export function rebuildFtsIndex(rows: FtsIndexRow[]): void {
  rebuildFtsRecords(rows);
}
