import fs from 'node:fs/promises';
import path from 'node:path';
import { getEmbeddingModelName } from '../models/embedding-config';
import { invalidateChunkCache } from './chunk-cache';
import { splitIntoChunks } from './chunker';
import {
  getDocument,
  listDocuments,
  replaceDocumentChunks,
  type DocumentInfo,
} from './documents';
import { embedTexts } from './embedding';
import { resolveKnowledgeFilePath } from './knowledge-path';
import { serializeEmbedding } from './vector';

export type ReindexProgress = {
  done: number;
  total: number;
  filename?: string;
};

export async function reindexDocument(documentId: string): Promise<DocumentInfo> {
  const doc = getDocument(documentId);
  if (!doc) throw new Error('文档不存在');

  const absolutePath = resolveKnowledgeFilePath(doc.filepath);
  const text = await fs.readFile(absolutePath, 'utf8');
  const chunks = splitIntoChunks(text, doc.filename);
  if (!chunks.length) throw new Error('文档内容为空');

  const BATCH = 10;
  const embeddedChunks: Array<{ content: string; embedding: Uint8Array }> = [];
  let embeddingDim = 0;

  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    const vectors = await embedTexts(batch);
    for (let j = 0; j < batch.length; j++) {
      embeddingDim = vectors[j].length;
      embeddedChunks.push({
        content: batch[j],
        embedding: serializeEmbedding(vectors[j]),
      });
    }
  }

  replaceDocumentChunks(documentId, embeddedChunks, {
    embeddingModel: getEmbeddingModelName(),
    embeddingDim,
  });

  invalidateChunkCache();
  return getDocument(documentId)!;
}

export async function reindexAllDocuments(
  onProgress?: (progress: ReindexProgress) => void,
): Promise<void> {
  const docs = listDocuments();
  for (let i = 0; i < docs.length; i++) {
    onProgress?.({ done: i, total: docs.length, filename: docs[i].filename });
    await reindexDocument(docs[i].id);
    onProgress?.({ done: i + 1, total: docs.length, filename: docs[i].filename });
  }
  invalidateChunkCache();
}
