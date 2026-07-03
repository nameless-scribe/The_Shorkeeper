import fs from 'node:fs/promises';
import path from 'node:path';
import { getEmbeddingModelName } from '../models/embedding-config';
import { buildChunkEmbedText } from './chunk-prefix';
import { invalidateChunkCache } from './chunk-cache';
import { invalidateDocCache } from './doc-cache';
import { splitIntoChunks } from './chunker';
import {
  getDocument,
  listDocuments,
  loadFtsSourceRows,
  rebuildFtsIndex,
  replaceDocumentChunks,
  updateDocumentMeta,
  type DocumentInfo,
} from './documents';
import { embedText, embedTexts } from './embedding';
import { resolveKnowledgeFilePath } from './knowledge-path';
import { generateDocumentSummary } from './summary';
import { serializeEmbedding } from './vector';

export type ReindexProgress = {
  done: number;
  total: number;
  filename?: string;
};

async function embedDocumentVector(filename: string, summary: string): Promise<Uint8Array> {
  const input = `${filename}\n${summary}`;
  const vec = await embedText(input);
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
  const docs = listDocuments();
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    onProgress?.({ done: i, total: docs.length, filename: doc.filename });

    const absolutePath = resolveKnowledgeFilePath(doc.filepath);
    const text = await fs.readFile(absolutePath, 'utf8');
    const { summary, outline } = generateDocumentSummary(text, doc.filename);
    const docEmbedding = await embedDocumentVector(doc.filename, summary);

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
  if (!doc) throw new Error('文档不存在');

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
    const vectors = await embedTexts(batch.map((c) => c.embedText));
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
  await reindexFts();
}
