import fs from 'node:fs/promises';
import path from 'node:path';
import { loadEmbeddingConfig, type EmbeddingApiConfig } from '../models/embedding-config';
import { buildChunkEmbedText } from './chunk-prefix';
import { invalidateChunkCache } from './chunk-cache';
import { invalidateDocCache } from './doc-cache';
import { CHUNK_OVERLAP, CHUNK_SIZE, splitIntoChunks } from './chunker';
import {
  getDocument,
  getPreviousDocumentVersionIds,
  listIndexedDocuments,
  listDocuments,
  loadFtsSourceRows,
  rebuildFtsIndex,
  replaceDocumentChunks,
  updateDocumentMeta,
  type DocumentInfo,
} from './documents';
import { embedText, embedTexts } from './embedding';
import { retryEmbeddingOperation } from './embedding-retry';
import { resolveKnowledgeFilePath } from './knowledge-path';
import { generateDocumentSummary } from './summary';
import { serializeEmbedding } from './vector';
import { runDocumentMutation } from './document-mutation-queue';
import { AbortSignalError, awaitWithAbort } from '../agent/abort';

export type ReindexProgress = {
  done: number;
  total: number;
  filename?: string;
  failed?: number;
};

export interface ReindexResult {
  indexed: number;
  failed: number;
}

async function embedDocumentVector(
  filename: string,
  summary: string,
  config: EmbeddingApiConfig,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const input = `${filename}\n${summary}`;
  const vec = await retryEmbeddingOperation(
    () => embedText(input, signal, config),
    { signal },
  );
  return serializeEmbedding(vec);
}

export async function reindexFts(): Promise<number> {
  const rows = loadFtsSourceRows();
  const ftsRows = rows.map((row) => ({
    chunkId: row.chunkId,
    documentId: row.documentId,
    ftsText: buildChunkEmbedText(row.filename, undefined, row.content),
    filename: row.filename,
  }));
  rebuildFtsIndex(ftsRows);
  return ftsRows.length;
}

export async function reindexDocEmbeddings(
  onProgress?: (progress: ReindexProgress) => void,
  options?: { signal?: AbortSignal },
): Promise<void> {
  const docs = listIndexedDocuments();
  const embeddingConfig = loadEmbeddingConfig();
  const currentModel = embeddingConfig.model;
  for (let i = 0; i < docs.length; i++) {
    if (options?.signal?.aborted) throw new AbortSignalError();
    const doc = docs[i];
    onProgress?.({ done: i, total: docs.length, filename: doc.filename });

    const absolutePath = resolveKnowledgeFilePath(doc.filepath);
    const text = await fs.readFile(absolutePath, {
      encoding: 'utf8',
      signal: options?.signal,
    });
    const { summary, outline } = generateDocumentSummary(text, doc.filename);
    const docEmbedding = await embedDocumentVector(
      doc.filename,
      summary,
      embeddingConfig,
      options?.signal,
    );
    const currentDimension = docEmbedding.byteLength / Float32Array.BYTES_PER_ELEMENT;

    if (doc.embeddingModel !== currentModel || doc.embeddingDim !== currentDimension) {
      throw new Error(`文档 ${doc.filename} 的索引配置不一致，请执行完整重建`);
    }

    updateDocumentMeta(doc.id, {
      summary,
      outline,
      docEmbedding,
    });
    onProgress?.({ done: i + 1, total: docs.length, filename: doc.filename });
  }
  invalidateDocCache();
}

const activeDocumentReindexes = new Map<string, Promise<DocumentInfo>>();
let activeFullReindex: Promise<ReindexResult> | null = null;

export function reindexDocument(
  documentId: string,
  options?: { signal?: AbortSignal },
): Promise<DocumentInfo> {
  return scheduleDocumentReindex(documentId, false, options);
}

function scheduleDocumentReindex(
  documentId: string,
  joinExisting: boolean,
  options?: { signal?: AbortSignal },
): Promise<DocumentInfo> {
  const existing = activeDocumentReindexes.get(documentId);
  if (existing && joinExisting) return existing;
  if (existing) {
    return Promise.reject(new Error('该文档正在重建'));
  }
  const run = runDocumentMutation(
    documentId,
    () => reindexDocumentUnlocked(documentId, options),
  );
  activeDocumentReindexes.set(documentId, run);
  void run.then(
    () => {
      if (activeDocumentReindexes.get(documentId) === run) {
        activeDocumentReindexes.delete(documentId);
      }
    },
    () => {
      if (activeDocumentReindexes.get(documentId) === run) {
        activeDocumentReindexes.delete(documentId);
      }
    },
  );
  return run;
}

async function reindexDocumentUnlocked(
  documentId: string,
  options?: { signal?: AbortSignal },
): Promise<DocumentInfo> {
  if (options?.signal?.aborted) throw new AbortSignalError();
  const doc = getDocument(documentId);
  if (!doc || doc.status === 'deleted' || doc.status === 'superseded') {
    throw new Error('文档不存在或已被新版本替代');
  }
  if (doc.status === 'importing') throw new Error('文档正在导入，暂不能重建');

  updateDocumentMeta(documentId, {
    status: 'needs_rebuild',
    statusError: null,
  });

  try {
    const embeddingConfig = loadEmbeddingConfig();
    const absolutePath = resolveKnowledgeFilePath(doc.filepath);
    const text = await fs.readFile(absolutePath, {
      encoding: 'utf8',
      signal: options?.signal,
    });
    const textChunks = splitIntoChunks(text, doc.filename);
    if (!textChunks.length) throw new Error('文档内容为空');

    const { summary, outline } = generateDocumentSummary(text, doc.filename);
    const docEmbedding = await embedDocumentVector(
      doc.filename,
      summary,
      embeddingConfig,
      options?.signal,
    );

    const BATCH = 10;
    const embeddedChunks: Array<{ content: string; embedding: Uint8Array; ftsText: string }> = [];
    let embeddingDim = 0;

    for (let i = 0; i < textChunks.length; i += BATCH) {
      if (options?.signal?.aborted) throw new AbortSignalError();
      const batch = textChunks.slice(i, i + BATCH);
      const vectors = await retryEmbeddingOperation(
        () => embedTexts(batch.map((c) => c.embedText), {
          signal: options?.signal,
          config: embeddingConfig,
        }),
        { signal: options?.signal },
      );
      for (let j = 0; j < batch.length; j++) {
        embeddingDim = vectors[j].length;
        embeddedChunks.push({
          content: batch[j].content,
          ftsText: batch[j].embedText,
          embedding: serializeEmbedding(vectors[j]),
        });
      }
    }

    if (options?.signal?.aborted) throw new AbortSignalError();
    replaceDocumentChunks(documentId, embeddedChunks, {
      embeddingModel: embeddingConfig.model,
      embeddingDim,
      summary,
      outline,
      docEmbedding,
      supersedeDocumentIds: getPreviousDocumentVersionIds(documentId),
      chunkSize: CHUNK_SIZE,
      chunkOverlap: CHUNK_OVERLAP,
    });

    invalidateChunkCache();
    return getDocument(documentId)!;
  } catch (error) {
    const cancelled = options?.signal?.aborted;
    const message = cancelled
      ? '重建已取消，请稍后重试'
      : error instanceof Error ? error.message : String(error);
    updateDocumentMeta(documentId, {
      status: cancelled ? 'needs_rebuild' : 'index_failed',
      statusError: message.slice(0, 500),
    });
    throw error;
  }
}

export function reindexAllDocuments(
  onProgress?: (progress: ReindexProgress) => void,
  options?: { signal?: AbortSignal },
): Promise<ReindexResult> {
  if (activeFullReindex) {
    return Promise.reject(new Error('知识库正在执行全量重建'));
  }
  const run = reindexAllDocumentsUnlocked(onProgress, options);
  activeFullReindex = run;
  void run.then(
    () => {
      if (activeFullReindex === run) activeFullReindex = null;
    },
    () => {
      if (activeFullReindex === run) activeFullReindex = null;
    },
  );
  return run;
}

async function reindexAllDocumentsUnlocked(
  onProgress?: (progress: ReindexProgress) => void,
  options?: { signal?: AbortSignal },
): Promise<ReindexResult> {
  const docs = listDocuments().filter((doc) => doc.status !== 'importing');
  let indexed = 0;
  let failed = 0;
  for (let i = 0; i < docs.length; i++) {
    if (options?.signal?.aborted) throw new AbortSignalError();
    const document = docs[i];
    onProgress?.({ done: i, total: docs.length, filename: document.filename, failed });
    if (!getDocument(document.id)) {
      onProgress?.({ done: i + 1, total: docs.length, filename: document.filename, failed });
      continue;
    }
    try {
      const scheduled = scheduleDocumentReindex(document.id, true, options);
      if (options?.signal) await awaitWithAbort(scheduled, options.signal);
      else await scheduled;
      indexed += 1;
    } catch {
      // A newer import may supersede this snapshot while it is rebuilding.
      // That is a successful version transition, not a failed reindex.
      if (getDocument(document.id)) failed += 1;
    }
    onProgress?.({ done: i + 1, total: docs.length, filename: document.filename, failed });
  }
  invalidateChunkCache();
  if (options?.signal?.aborted) throw new AbortSignalError();
  await reindexFts();
  return { indexed, failed };
}
