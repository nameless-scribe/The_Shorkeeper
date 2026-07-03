import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db';
import { invalidateDocCache } from './doc-cache';
import { invalidateChunkCache } from './chunk-cache';
import {
  buildFtsMatchQuery,
  extractSearchTerms,
  searchChunksSparseInMemory,
  type SparseHit,
} from './sparse-search';
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
  summary?: string | null;
  outline?: string | null;
}

type DocumentRow = {
  id: string;
  filename: string;
  filepath: string;
  mime_type: string | null;
  chunk_count: number;
  imported_at: number;
  content_hash?: string | null;
  embedding_model?: string | null;
  embedding_dim?: number | null;
  summary?: string | null;
  outline?: string | null;
};

function rowToInfo(row: DocumentRow): DocumentInfo {
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
    summary: row.summary ?? null,
    outline: row.outline ?? null,
  };
}

const DOCUMENT_SELECT =
  'id, filename, filepath, mime_type, chunk_count, imported_at, content_hash, embedding_model, embedding_dim, summary, outline';

export function computeContentHash(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

export function findDocumentByContentHash(hash: string): DocumentInfo | undefined {
  const db = getDatabase();
  const row = db
    .prepare(`SELECT ${DOCUMENT_SELECT} FROM documents WHERE content_hash = ? LIMIT 1`)
    .get(hash) as DocumentRow | undefined;
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
    .all() as DocumentRow[];

  return rows.map(rowToInfo);
}

export function getDocument(id: string): DocumentInfo | undefined {
  const db = getDatabase();
  const row = db
    .prepare(`SELECT ${DOCUMENT_SELECT} FROM documents WHERE id = ?`)
    .get(id) as DocumentRow | undefined;

  return row ? rowToInfo(row) : undefined;
}

export function hasFtsTable(): boolean {
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
  ftsText: string,
  filename: string,
): void {
  if (!hasFtsTable()) return;
  getDatabase()
    .prepare(
      `INSERT INTO document_chunks_fts (chunk_id, document_id, content, filename)
       VALUES (?, ?, ?, ?)`,
    )
    .run(chunkId, documentId, ftsText, filename);
}

function deleteChunksFtsForDocument(documentId: string): void {
  if (!hasFtsTable()) return;
  getDatabase()
    .prepare('DELETE FROM document_chunks_fts WHERE document_id = ?')
    .run(documentId);
}

export type FtsSearchHit = SparseHit & { rank?: number };

function searchChunksFtsNative(
  query: string,
  limit: number,
  documentIds?: string[],
): FtsSearchHit[] {
  const db = getDatabase();
  const trimmed = query.trim();
  if (!trimmed) return [];

  const rankByChunkId = new Map<string, number>();
  const matchQuery = buildFtsMatchQuery(trimmed);

  const tryMatch = (term: string): void => {
    if (!term) return;
    try {
      const docFilter =
        documentIds?.length ?
          ` AND document_id IN (${documentIds.map(() => '?').join(',')})`
        : '';
      const rows = db
        .prepare(
          `SELECT chunk_id, bm25(document_chunks_fts) AS rank
           FROM document_chunks_fts
           WHERE document_chunks_fts MATCH ?${docFilter}
           ORDER BY rank
           LIMIT ?`,
        )
        .all(
          ...(documentIds?.length ? [term, ...documentIds, limit * 2] : [term, limit * 2]),
        ) as Array<{ chunk_id: string; rank: number }>;
      for (const row of rows) {
        const prev = rankByChunkId.get(row.chunk_id);
        if (prev == null || row.rank < prev) {
          rankByChunkId.set(row.chunk_id, row.rank);
        }
      }
    } catch {
      /* skip invalid MATCH */
    }
  };

  tryMatch(matchQuery);
  if (!rankByChunkId.size) {
    for (const term of extractSearchTerms(trimmed)) {
      tryMatch(buildFtsMatchQuery(term));
    }
  }

  if (!rankByChunkId.size) return [];

  const sortedIds = [...rankByChunkId.entries()]
    .sort((a, b) => a[1] - b[1])
    .slice(0, limit);

  const results: FtsSearchHit[] = [];

  for (const [chunkId, rank] of sortedIds) {
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
      if (documentIds?.length && !documentIds.includes(row.document_id)) continue;
      results.push({
        chunkId: row.chunk_id,
        documentId: row.document_id,
        content: row.content,
        filename: row.filename,
        chunkIndex: row.chunk_index,
        score: -rank,
        rank,
      });
    }
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
      hits = hits.filter((h) => allowed.has(h.documentId));
    }
    hits = hits.slice(0, limit);
  }
  return hits;
}

export function getAdjacentChunks(
  documentId: string,
  chunkIndex: number,
  window: number,
): Array<{ chunkIndex: number; content: string }> {
  if (window <= 0) return [];

  const db = getDatabase();
  const minIndex = Math.max(0, chunkIndex - window);
  const maxIndex = chunkIndex + window;

  const rows = db
    .prepare(
      `SELECT chunk_index, content FROM document_chunks
       WHERE document_id = ? AND chunk_index >= ? AND chunk_index <= ?
       ORDER BY chunk_index ASC`,
    )
    .all(documentId, minIndex, maxIndex) as Array<{ chunk_index: number; content: string }>;

  return rows.map((r) => ({ chunkIndex: r.chunk_index, content: r.content }));
}

export function deleteDocument(id: string): boolean {
  const doc = getDocument(id);
  if (!doc) return false;

  const db = getDatabase();
  deleteChunksFtsForDocument(id);
  db.prepare('DELETE FROM document_chunks WHERE document_id = ?').run(id);
  db.prepare('DELETE FROM documents WHERE id = ?').run(id);
  invalidateChunkCache();
  invalidateDocCache();

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
  chunks: Array<{ content: string; embedding: Uint8Array; ftsText: string }>;
  contentHash?: string | null;
  embeddingModel?: string | null;
  embeddingDim?: number | null;
  summary?: string | null;
  outline?: string | null;
  docEmbedding?: Uint8Array | null;
}): DocumentInfo {
  const db = getDatabase();
  const docId = uuidv4();
  const now = Date.now();

  db.beginBatch();
  try {
    db.prepare(
      `INSERT INTO documents (
         id, filename, filepath, mime_type, chunk_count, imported_at,
         content_hash, embedding_model, embedding_dim, summary, outline, embedding
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      input.summary ?? null,
      input.outline ?? null,
      input.docEmbedding ?? null,
    );

    const insertChunk = db.prepare(
      `INSERT INTO document_chunks (id, document_id, chunk_index, content, embedding)
       VALUES (?, ?, ?, ?, ?)`,
    );

    input.chunks.forEach((chunk, index) => {
      const chunkId = uuidv4();
      insertChunk.run(chunkId, docId, index, chunk.content, chunk.embedding);
      insertChunkFts(chunkId, docId, chunk.ftsText, input.filename);
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
  invalidateDocCache();

  return getDocument(docId)!;
}

export function updateDocumentMeta(
  documentId: string,
  meta: {
    summary?: string | null;
    outline?: string | null;
    docEmbedding?: Uint8Array | null;
    embeddingModel?: string | null;
    embeddingDim?: number | null;
  },
): void {
  const db = getDatabase();
  const sets: string[] = [];
  const params: unknown[] = [];

  if (meta.summary !== undefined) {
    sets.push('summary = ?');
    params.push(meta.summary);
  }
  if (meta.outline !== undefined) {
    sets.push('outline = ?');
    params.push(meta.outline);
  }
  if (meta.docEmbedding !== undefined) {
    sets.push('embedding = ?');
    params.push(meta.docEmbedding);
  }
  if (meta.embeddingModel !== undefined) {
    sets.push('embedding_model = ?');
    params.push(meta.embeddingModel);
  }
  if (meta.embeddingDim !== undefined) {
    sets.push('embedding_dim = ?');
    params.push(meta.embeddingDim);
  }

  if (!sets.length) return;

  params.push(documentId);
  db.prepare(`UPDATE documents SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  invalidateDocCache();
}

export function replaceDocumentChunks(
  documentId: string,
  chunks: Array<{ content: string; embedding: Uint8Array; ftsText: string }>,
  meta?: {
    embeddingModel?: string;
    embeddingDim?: number;
    summary?: string | null;
    outline?: string | null;
    docEmbedding?: Uint8Array | null;
  },
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
      insertChunkFts(chunkId, documentId, chunk.ftsText, doc.filename);
    });

    const updates = ['chunk_count = ?', 'embedding_model = ?', 'embedding_dim = ?'];
    const params: unknown[] = [
      chunks.length,
      meta?.embeddingModel ?? doc.embeddingModel,
      meta?.embeddingDim ?? doc.embeddingDim,
    ];

    if (meta?.summary !== undefined) {
      updates.push('summary = ?');
      params.push(meta.summary);
    }
    if (meta?.outline !== undefined) {
      updates.push('outline = ?');
      params.push(meta.outline);
    }
    if (meta?.docEmbedding !== undefined) {
      updates.push('embedding = ?');
      params.push(meta.docEmbedding);
    }

    params.push(documentId);
    db.prepare(`UPDATE documents SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  } finally {
    db.endBatch();
  }

  invalidateChunkCache();
  invalidateDocCache();
}

export function loadAllDocumentEmbeddings(): Array<{
  id: string;
  filename: string;
  summary: string | null;
  embedding: Uint8Array;
}> {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT id, filename, summary, embedding FROM documents
       WHERE embedding IS NOT NULL`,
    )
    .all() as Array<{
    id: string;
    filename: string;
    summary: string | null;
    embedding: Uint8Array;
  }>;

  return rows.map((row) => ({
    ...row,
    embedding:
      row.embedding instanceof Uint8Array ?
        row.embedding
      : new Uint8Array(row.embedding as ArrayBuffer),
  }));
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

export function loadFtsSourceRows(): Array<{
  chunkId: string;
  documentId: string;
  content: string;
  filename: string;
}> {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT c.id AS chunkId, c.document_id AS documentId, c.content, d.filename
       FROM document_chunks c
       JOIN documents d ON d.id = c.document_id`,
    )
    .all() as Array<{
    chunkId: string;
    documentId: string;
    content: string;
    filename: string;
  }>;
}

export function rebuildFtsIndex(
  rows: Array<{ chunkId: string; documentId: string; ftsText: string; filename: string }>,
): void {
  if (!hasFtsTable()) return;

  const db = getDatabase();
  db.beginBatch();
  try {
    db.exec('DELETE FROM document_chunks_fts');
    const insert = db.prepare(
      `INSERT INTO document_chunks_fts (chunk_id, document_id, content, filename)
       VALUES (?, ?, ?, ?)`,
    );
    for (const row of rows) {
      insert.run(row.chunkId, row.documentId, row.ftsText, row.filename);
    }
  } finally {
    db.endBatch();
  }
}
