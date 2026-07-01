import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { getWorkspaceDir } from '../config/paths';
import { getDatabase } from '../db';
import { invalidateChunkCache } from './chunk-cache';
import { deserializeEmbedding } from './vector';
import { resolveKnowledgeFilePath } from './knowledge-path';

export interface DocumentInfo {
  id: string;
  filename: string;
  filepath: string;
  mimeType: string | null;
  chunkCount: number;
  importedAt: number;
  contentHash?: string | null;
  embeddingModel?: string | null;
  embeddingDim?: number | null;
}

function rowToInfo(row: {
  id: string;
  filename: string;
  filepath: string;
  mime_type: string | null;
  chunk_count: number;
  imported_at: number;
  content_hash?: string | null;
  embedding_model?: string | null;
  embedding_dim?: number | null;
}): DocumentInfo {
  return {
    id: row.id,
    filename: row.filename,
    filepath: row.filepath,
    mimeType: row.mime_type,
    chunkCount: row.chunk_count,
    importedAt: row.imported_at,
    contentHash: row.content_hash ?? null,
    embeddingModel: row.embedding_model ?? null,
    embeddingDim: row.embedding_dim ?? null,
  };
}

const DOCUMENT_SELECT =
  'id, filename, filepath, mime_type, chunk_count, imported_at, content_hash, embedding_model, embedding_dim';

export function computeContentHash(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

export function findDocumentByContentHash(hash: string): DocumentInfo | undefined {
  const db = getDatabase();
  const row = db
    .prepare(`SELECT ${DOCUMENT_SELECT} FROM documents WHERE content_hash = ? LIMIT 1`)
    .get(hash) as Parameters<typeof rowToInfo>[0] | undefined;
  return row ? rowToInfo(row) : undefined;
}

export function getStoredEmbeddingDimensions(): number[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT DISTINCT embedding_dim AS dim FROM documents
       WHERE embedding_dim IS NOT NULL AND embedding_dim > 0`,
    )
    .all() as Array<{ dim: number }>;
  return rows.map((r) => r.dim);
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

export function listDocuments(): DocumentInfo[] {
  const db = getDatabase();
  const rows = db
    .prepare(`SELECT ${DOCUMENT_SELECT} FROM documents ORDER BY imported_at DESC`)
    .all() as Array<Parameters<typeof rowToInfo>[0]>;

  return rows.map(rowToInfo);
}

export function getDocument(id: string): DocumentInfo | undefined {
  const db = getDatabase();
  const row = db
    .prepare(`SELECT ${DOCUMENT_SELECT} FROM documents WHERE id = ?`)
    .get(id) as Parameters<typeof rowToInfo>[0] | undefined;

  return row ? rowToInfo(row) : undefined;
}

function hasFtsTable(): boolean {
  try {
    getDatabase().prepare('SELECT chunk_id FROM document_chunks_fts LIMIT 1').get();
    return true;
  } catch {
    return false;
  }
}

function insertChunkFts(
  chunkId: string,
  documentId: string,
  content: string,
  filename: string,
): void {
  if (!hasFtsTable()) return;
  getDatabase()
    .prepare(
      `INSERT INTO document_chunks_fts (chunk_id, document_id, content, filename)
       VALUES (?, ?, ?, ?)`,
    )
    .run(chunkId, documentId, content, filename);
}

function deleteChunksFtsForDocument(documentId: string): void {
  if (!hasFtsTable()) return;
  getDatabase()
    .prepare('DELETE FROM document_chunks_fts WHERE document_id = ?')
    .run(documentId);
}

export function searchChunksFts(
  query: string,
  limit: number,
): Array<{
  chunkId: string;
  documentId: string;
  content: string;
  filename: string;
  chunkIndex: number;
}> {
  if (!hasFtsTable()) return [];

  const db = getDatabase();
  const trimmed = query.trim();
  const tokens = trimmed
    .split(/[\s,，。！？、]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);

  const rankByChunkId = new Map<string, number>();

  const tryMatch = (term: string): void => {
    if (!term) return;
    try {
      const rows = db
        .prepare(
          `SELECT chunk_id, bm25(document_chunks_fts) AS rank
           FROM document_chunks_fts
           WHERE document_chunks_fts MATCH ?
           ORDER BY rank
           LIMIT ?`,
        )
        .all(term, limit * 2) as Array<{ chunk_id: string; rank: number }>;
      for (const row of rows) {
        const prev = rankByChunkId.get(row.chunk_id);
        if (prev == null || row.rank < prev) {
          rankByChunkId.set(row.chunk_id, row.rank);
        }
      }
    } catch {
      /* 跳过无效 MATCH token */
    }
  };

  tryMatch(trimmed);
  for (const token of tokens) {
    tryMatch(token);
  }

  if (!rankByChunkId.size) return [];

  const sortedIds = [...rankByChunkId.entries()]
    .sort((a, b) => a[1] - b[1])
    .slice(0, limit)
    .map(([id]) => id);

  const results: Array<{
    chunkId: string;
    documentId: string;
    content: string;
    filename: string;
    chunkIndex: number;
  }> = [];

  for (const chunkId of sortedIds) {
    const row = db
      .prepare(
        `SELECT dc.id AS chunk_id, dc.document_id, dc.content, dc.chunk_index, d.filename
         FROM document_chunks dc
         JOIN documents d ON d.id = dc.document_id
         WHERE dc.id = ?`,
      )
      .get(chunkId) as
      | {
          chunk_id: string;
          document_id: string;
          content: string;
          chunk_index: number;
          filename: string;
        }
      | undefined;
    if (row) {
      results.push({
        chunkId: row.chunk_id,
        documentId: row.document_id,
        content: row.content,
        filename: row.filename,
        chunkIndex: row.chunk_index,
      });
    }
  }

  return results;
}

export function deleteDocument(id: string): boolean {
  const doc = getDocument(id);
  if (!doc) return false;

  const db = getDatabase();
  deleteChunksFtsForDocument(id);
  db.prepare('DELETE FROM document_chunks WHERE document_id = ?').run(id);
  db.prepare('DELETE FROM documents WHERE id = ?').run(id);
  invalidateChunkCache();

  try {
    const absolutePath = resolveKnowledgeFilePath(doc.filepath);
    void fs.unlink(absolutePath).catch(() => undefined);
  } catch {
    // filepath 不在 knowledge 目录内时仅删 DB 记录
  }

  return true;
}

export function insertDocumentWithChunks(input: {
  filename: string;
  filepath: string;
  mimeType: string | null;
  chunks: Array<{ content: string; embedding: Uint8Array }>;
  contentHash?: string | null;
  embeddingModel?: string | null;
  embeddingDim?: number | null;
}): DocumentInfo {
  const db = getDatabase();
  const docId = uuidv4();
  const now = Date.now();

  db.beginBatch();
  try {
    db.prepare(
      `INSERT INTO documents (
         id, filename, filepath, mime_type, chunk_count, imported_at,
         content_hash, embedding_model, embedding_dim
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      docId,
      input.filename,
      input.filepath,
      input.mimeType,
      input.chunks.length,
      now,
      input.contentHash ?? null,
      input.embeddingModel ?? null,
      input.embeddingDim ?? null,
    );

    const insertChunk = db.prepare(
      `INSERT INTO document_chunks (id, document_id, chunk_index, content, embedding)
       VALUES (?, ?, ?, ?, ?)`,
    );

    input.chunks.forEach((chunk, index) => {
      const chunkId = uuidv4();
      insertChunk.run(chunkId, docId, index, chunk.content, chunk.embedding);
      insertChunkFts(chunkId, docId, chunk.content, input.filename);
    });
  } catch (err) {
    deleteChunksFtsForDocument(docId);
    db.prepare('DELETE FROM document_chunks WHERE document_id = ?').run(docId);
    db.prepare('DELETE FROM documents WHERE id = ?').run(docId);
    try {
      const absolutePath = resolveKnowledgeFilePath(input.filepath);
      void fs.unlink(absolutePath).catch(() => undefined);
    } catch {
      /* ignore orphan cleanup errors */
    }
    throw err;
  } finally {
    db.endBatch();
  }

  invalidateChunkCache();

  return {
    id: docId,
    filename: input.filename,
    filepath: input.filepath,
    mimeType: input.mimeType,
    chunkCount: input.chunks.length,
    importedAt: now,
    contentHash: input.contentHash ?? null,
    embeddingModel: input.embeddingModel ?? null,
    embeddingDim: input.embeddingDim ?? null,
  };
}

export function replaceDocumentChunks(
  documentId: string,
  chunks: Array<{ content: string; embedding: Uint8Array }>,
  meta?: { embeddingModel?: string; embeddingDim?: number },
): void {
  const doc = getDocument(documentId);
  if (!doc) throw new Error('文档不存在');

  const db = getDatabase();
  db.beginBatch();
  try {
    deleteChunksFtsForDocument(documentId);
    db.prepare('DELETE FROM document_chunks WHERE document_id = ?').run(documentId);

    const insertChunk = db.prepare(
      `INSERT INTO document_chunks (id, document_id, chunk_index, content, embedding)
       VALUES (?, ?, ?, ?, ?)`,
    );

    chunks.forEach((chunk, index) => {
      const chunkId = uuidv4();
      insertChunk.run(chunkId, documentId, index, chunk.content, chunk.embedding);
      insertChunkFts(chunkId, documentId, chunk.content, doc.filename);
    });

    db.prepare(
      `UPDATE documents SET chunk_count = ?, embedding_model = ?, embedding_dim = ? WHERE id = ?`,
    ).run(
      chunks.length,
      meta?.embeddingModel ?? doc.embeddingModel,
      meta?.embeddingDim ?? doc.embeddingDim,
      documentId,
    );
  } finally {
    db.endBatch();
  }

  invalidateChunkCache();
}

export function loadAllChunkEmbeddings(): Array<{
  id: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  filename: string;
  embedding: Float32Array;
}> {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT c.id, c.document_id, c.chunk_index, c.content, c.embedding, d.filename
       FROM document_chunks c
       JOIN documents d ON d.id = c.document_id`,
    )
    .all() as Array<{
    id: string;
    document_id: string;
    chunk_index: number;
    content: string;
    embedding: Uint8Array;
    filename: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    documentId: row.document_id,
    chunkIndex: row.chunk_index,
    content: row.content,
    filename: row.filename,
    embedding: deserializeEmbedding(
      row.embedding instanceof Uint8Array
        ? row.embedding
        : new Uint8Array(row.embedding as ArrayBuffer),
    ),
  }));
}
