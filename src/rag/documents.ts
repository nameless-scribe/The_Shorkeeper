import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  deleteDocumentData,
  findDocumentByContentHash,
  getAdjacentChunks,
  getChunkSearchRows,
  getDocument,
  getDocumentChunk,
  getDocumentIncludingDeleted,
  getDocumentVersionPlan,
  getPreviousDocumentVersionIds,
  getStoredEmbeddingDimensions,
  hasDocumentChunksFts,
  insertDocumentWithChunks as insertDocumentRecords,
  listIndexedDocuments,
  listDocuments,
  loadAllChunkEmbeddingRecords,
  loadAllDocumentEmbeddings,
  loadFtsSourceRows,
  rebuildFtsIndex as rebuildFtsRecords,
  replaceDocumentChunks as replaceDocumentChunkRecords,
  searchDocumentChunkFtsRanks,
  updateDocumentMeta as updateDocumentMetaRecord,
  recoverInterruptedDocumentImports as recoverInterruptedDocumentImportsRecord,
  type DocumentInfo,
  type DocumentStatus,
  type DocumentMetaPatch,
  type FtsIndexRow,
  type RagChunkInput,
  type ReplaceDocumentChunksMeta,
} from '../db/repositories/rag-documents';
import type {
  DocumentFreshnessStatus,
  DocumentSourceKind,
  DocumentSyncPolicy,
} from '../shared/types';
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
import { CHUNK_OVERLAP, CHUNK_SIZE } from './chunker';
import { getWorkspaceDir } from '../config/paths';
import { resolveWorkspacePath } from '../tools/file/workspace-path';
import { runDocumentMutation } from './document-mutation-queue';

export {
  findDocumentByContentHash,
  getAdjacentChunks,
  getDocument,
  getDocumentChunk,
  getDocumentIncludingDeleted,
  getDocumentVersionPlan,
  getPreviousDocumentVersionIds,
  getStoredEmbeddingDimensions,
  listDocuments,
  listIndexedDocuments,
  loadAllDocumentEmbeddings,
  loadFtsSourceRows,
  type DocumentInfo,
  type DocumentStatus,
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

export function checkKnowledgeIndexCompatibility(
  currentModel: string,
  currentDim: number | null,
): {
  storedDimensions: number[];
  storedModels: string[];
  storedChunkConfigs: Array<{ size: number; overlap: number }>;
  hasMismatch: boolean;
  modelMismatch: boolean;
  dimensionMismatch: boolean;
  chunkConfigMismatch: boolean;
} {
  const docs = listIndexedDocuments();
  const storedDimensions = [...new Set(
    docs.map((doc) => doc.embeddingDim).filter((dim): dim is number => Boolean(dim && dim > 0)),
  )];
  const storedModels = [...new Set(
    docs.map((doc) => doc.embeddingModel).filter((model): model is string => Boolean(model)),
  )];
  const storedChunkConfigs = [...new Map(
    docs.map((doc) => [
      `${doc.chunkSize}:${doc.chunkOverlap}`,
      { size: doc.chunkSize, overlap: doc.chunkOverlap },
    ]),
  ).values()];
  const modelMismatch = docs.some((doc) => doc.embeddingModel !== currentModel);
  const dimensionMismatch = currentDim && currentDim > 0
    ? docs.some((doc) => doc.embeddingDim !== currentDim)
    : storedDimensions.length > 1;
  const chunkConfigMismatch = docs.some(
    (doc) => doc.chunkSize !== CHUNK_SIZE || doc.chunkOverlap !== CHUNK_OVERLAP,
  );
  return {
    storedDimensions,
    storedModels,
    storedChunkConfigs,
    hasMismatch: modelMismatch || dimensionMismatch || chunkConfigMismatch,
    modelMismatch,
    dimensionMismatch,
    chunkConfigMismatch,
  };
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

export interface KnowledgeTrashRecoveryResult {
  restored: number;
  cleaned: number;
  retained: number;
}

/** Recover the two crash windows around file quarantine and the DB delete transaction. */
export async function recoverKnowledgeTrash(): Promise<KnowledgeTrashRecoveryResult> {
  const result: KnowledgeTrashRecoveryResult = { restored: 0, cleaned: 0, retained: 0 };
  const trashDir = resolveWorkspacePath(getWorkspaceDir(), 'knowledge/.trash');
  const entries = await fs.readdir(trashDir, { withFileTypes: true }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  });

  for (const entry of entries) {
    const match = entry.name.match(/^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})-/i);
    if (!match || !entry.isFile()) {
      result.retained += 1;
      continue;
    }
    const quarantinePath = path.join(trashDir, entry.name);
    const document = getDocumentIncludingDeleted(match[1]);
    if (!document) {
      result.retained += 1;
      continue;
    }
    if (document.status === 'deleted') {
      await fs.unlink(quarantinePath);
      result.cleaned += 1;
      continue;
    }

    const originalPath = resolveKnowledgeFilePath(document.filepath);
    const originalExists = await fs.stat(originalPath).then(
      (stat) => stat.isFile(),
      (error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      },
    );
    if (originalExists) {
      await fs.unlink(quarantinePath);
      result.cleaned += 1;
      continue;
    }
    await fs.mkdir(path.dirname(originalPath), { recursive: true });
    await restoreQuarantinedFile(quarantinePath, originalPath);
    result.restored += 1;
  }
  return result;
}

export async function deleteDocument(id: string): Promise<boolean> {
  return runDocumentMutation(id, () => deleteDocumentUnlocked(id));
}

async function deleteDocumentUnlocked(id: string): Promise<boolean> {
  const document = getDocument(id);
  if (!document || document.status === 'deleted') return false;

  const absolutePath = resolveKnowledgeFilePath(document.filepath);
  const trashDir = resolveWorkspacePath(getWorkspaceDir(), 'knowledge/.trash');
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
  status?: DocumentStatus;
  statusError?: string | null;
  sourcePath?: string | null;
  title?: string;
  titleKey?: string;
  version?: number;
  chunkSize?: number;
  chunkOverlap?: number;
  sourceKind?: DocumentSourceKind;
  sourceModifiedAt?: number | null;
  sourceSize?: number | null;
  lastCheckedAt?: number | null;
  freshnessStatus?: DocumentFreshnessStatus;
  staleReason?: string | null;
  syncPolicy?: DocumentSyncPolicy;
}): DocumentInfo {
  const document = insertDocumentRecords(input);

  invalidateChunkCache();
  invalidateDocCache();
  return document;
}

export function updateDocumentMeta(documentId: string, meta: DocumentMetaPatch): void {
  updateDocumentMetaRecord(documentId, meta);
  if (meta.status !== undefined) invalidateChunkCache();
  invalidateDocCache();
}

export function recoverInterruptedDocumentImports(): number {
  const count = recoverInterruptedDocumentImportsRecord();
  if (count > 0) {
    invalidateChunkCache();
    invalidateDocCache();
  }
  return count;
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
