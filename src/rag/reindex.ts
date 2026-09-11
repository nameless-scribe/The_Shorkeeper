import fs from 'node:fs/promises';
import path from 'node:path';
import { getEmbeddingModelName } from '../models/embedding-config';
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

async function embedDocumentVector(filename: string, summary: string): Promise<Uint8Array> {
  const input = `${filename}\n${summary}`;
  const vec = await retryEmbeddingOperation(() => embedText(input));
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
): Promise<void> {
  const docs = listIndexedDocuments();
  const currentModel = getEmbeddingModelName();
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    onProgress?.({ done: i, total: docs.length, filename: doc.filename });

    const absolutePath = resolveKnowledgeFilePath(doc.filepath);
    const text = await fs.readFile(absolutePath, 'utf8');
    const { summary, outline } = generateDocumentSummary(text, doc.filename);
    const docEmbedding = await embedDocumentVector(doc.filename, summary);
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

export async function reindexDocument(documentId: string): Promise<DocumentInfo> {
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
    const absolutePath = resolveKnowledgeFilePath(doc.filepath);
    const text = await fs.readFile(absolutePath, 'utf8');
    const textChunks = splitIntoChunks(text, doc.filename);
    if (!textChunks.length) throw new Error('文档内容为空');

    const { summary, outline } = generateDocumentSummary(text, doc.filename);
    const docEmbedding = await embedDocumentVector(doc.filename, summary);

    const BATCH = 10;
    const embeddedChunks: Array<{ content: string; embedding: Uint8Array; ftsText: string }> = [];
    let embeddingDim = 0;

    for (let i = 0; i < textChunks.length; i += BATCH) {
      const batch = textChunks.slice(i, i + BATCH);
      const vectors = await retryEmbeddingOperation(
        () => embedTexts(batch.map((c) => c.embedText)),
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

    replaceDocumentChunks(documentId, embeddedChunks, {
      embeddingModel: getEmbeddingModelName(),
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
    const message = error instanceof Error ? error.message : String(error);
    updateDocumentMeta(documentId, {
      status: 'index_failed',
      statusError: message.slice(0, 500),
    });
    throw error;
  }
}

export async function reindexAllDocuments(
  onProgress?: (progress: ReindexProgress) => void,
): Promise<ReindexResult> {
  const docs = listDocuments().filter((doc) => doc.status !== 'importing');
  let indexed = 0;
  let failed = 0;
  for (let i = 0; i < docs.length; i++) {
    const document = docs[i];
    onProgress?.({ done: i, total: docs.length, filename: document.filename, failed });
    if (!getDocument(document.id)) {
      onProgress?.({ done: i + 1, total: docs.length, filename: document.filename, failed });
      continue;
    }
    try {
      await reindexDocument(document.id);
      indexed += 1;
    } catch {
      // A newer import may supersede this snapshot while it is rebuilding.
      // That is a successful version transition, not a failed reindex.
      if (getDocument(document.id)) failed += 1;
    }
    onProgress?.({ done: i + 1, total: docs.length, filename: document.filename, failed });
  }
  invalidateChunkCache();
  await reindexFts();
  return { indexed, failed };
}
