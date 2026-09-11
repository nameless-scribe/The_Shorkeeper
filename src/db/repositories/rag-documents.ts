import { v4 as uuidv4 } from 'uuid';
import { getDatabase, type AppDatabase, type DatabaseStatement } from '../index';

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

export interface RagChunkInput {
  content: string;
  embedding: Uint8Array;
  ftsText: string;
}

export interface InsertDocumentInput {
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
}

export interface DocumentMetaPatch {
  summary?: string | null;
  outline?: string | null;
  docEmbedding?: Uint8Array | null;
  embeddingModel?: string | null;
  embeddingDim?: number | null;
}

export interface ReplaceDocumentChunksMeta extends DocumentMetaPatch {
  embeddingModel?: string;
  embeddingDim?: number;
}

export interface DocumentEmbeddingRecord {
  id: string;
  filename: string;
  summary: string | null;
  embedding: Uint8Array;
}

export interface ChunkEmbeddingRecord {
  id: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  filename: string;
  embedding: Uint8Array;
}

export interface FtsSourceRow {
  chunkId: string;
  documentId: string;
  content: string;
  filename: string;
}

export interface FtsIndexRow {
  chunkId: string;
  documentId: string;
  ftsText: string;
  filename: string;
}

export interface FtsRankRow {
  chunkId: string;
  rank: number;
}

export interface ChunkSearchRow {
  chunkId: string;
  documentId: string;
  content: string;
  chunkIndex: number;
  filename: string;
}

export interface AdjacentChunk {
  chunkIndex: number;
  content: string;
}

interface DocumentRow {
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
}

const DOCUMENT_SELECT =
  'id, filename, filepath, mime_type, chunk_count, imported_at, content_hash, embedding_model, embedding_dim, summary, outline';

function toOptionalBlob(value: unknown): Uint8Array | null {
  if (value == null) return null;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}

function toRequiredBlob(value: unknown, owner: string): Uint8Array {
  const blob = toOptionalBlob(value);
  if (!blob) throw new Error(`${owner} 的 embedding BLOB 格式无效`);
  return blob;
}

function rowToDocument(row: DocumentRow): DocumentInfo {
  return {
    id: String(row.id),
    filename: String(row.filename),
    filepath: String(row.filepath),
    mimeType: row.mime_type == null ? null : String(row.mime_type),
    chunkCount: Number(row.chunk_count),
    importedAt: Number(row.imported_at),
    contentHash: row.content_hash == null ? null : String(row.content_hash),
    embeddingModel:
      row.embedding_model == null ? null : String(row.embedding_model),
    embeddingDim: row.embedding_dim == null ? null : Number(row.embedding_dim),
    summary: row.summary == null ? null : String(row.summary),
    outline: row.outline == null ? null : String(row.outline),
  };
}

export function findDocumentByContentHash(
  hash: string,
  db: AppDatabase = getDatabase(),
): DocumentInfo | undefined {
  const row = db
    .prepare(`SELECT ${DOCUMENT_SELECT} FROM documents WHERE content_hash = ? LIMIT 1`)
    .get(hash) as unknown as DocumentRow | undefined;
  return row ? rowToDocument(row) : undefined;
}

export function getStoredEmbeddingDimensions(
  db: AppDatabase = getDatabase(),
): number[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT embedding_dim AS dim FROM documents
       WHERE embedding_dim IS NOT NULL AND embedding_dim > 0`,
    )
    .all() as Array<{ dim: number }>;
  return rows.map((row) => Number(row.dim));
}

export function listDocuments(db: AppDatabase = getDatabase()): DocumentInfo[] {
  const rows = db
    .prepare(`SELECT ${DOCUMENT_SELECT} FROM documents ORDER BY imported_at DESC`)
    .all() as unknown as DocumentRow[];
  return rows.map(rowToDocument);
}

export function getDocument(
  id: string,
  db: AppDatabase = getDatabase(),
): DocumentInfo | undefined {
  const row = db
    .prepare(`SELECT ${DOCUMENT_SELECT} FROM documents WHERE id = ?`)
    .get(id) as unknown as DocumentRow | undefined;
  return row ? rowToDocument(row) : undefined;
}

export function hasDocumentChunksFts(db: AppDatabase = getDatabase()): boolean {
  try {
    db.prepare('SELECT chunk_id FROM document_chunks_fts LIMIT 1').get();
    return true;
  } catch {
    return false;
  }
}

export function searchDocumentChunkFtsRanks(
  matchQuery: string,
  limit: number,
  documentIds?: string[],
  db: AppDatabase = getDatabase(),
): FtsRankRow[] | null {
  if (!matchQuery) return [];
  try {
    const docFilter =
      documentIds?.length ?
        ` AND document_id IN (${documentIds.map(() => '?').join(',')})`
      : '';
    const params =
      documentIds?.length ? [matchQuery, ...documentIds, limit] : [matchQuery, limit];
    const rows = db
      .prepare(
        `SELECT chunk_id, bm25(document_chunks_fts) AS rank
         FROM document_chunks_fts
         WHERE document_chunks_fts MATCH ?${docFilter}
         ORDER BY rank
         LIMIT ?`,
      )
      .all(...params) as Array<{ chunk_id: string; rank: number }>;
    return rows.map((row) => ({ chunkId: String(row.chunk_id), rank: Number(row.rank) }));
  } catch {
    return null;
  }
}

export function getChunkSearchRows(
  chunkIds: string[],
  db: AppDatabase = getDatabase(),
): ChunkSearchRow[] {
  if (!chunkIds.length) return [];
  const placeholders = chunkIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT dc.id AS chunk_id, dc.document_id, dc.content, dc.chunk_index, d.filename
       FROM document_chunks dc
       JOIN documents d ON d.id = dc.document_id
       WHERE dc.id IN (${placeholders})`,
    )
    .all(...chunkIds) as Array<{
    chunk_id: string;
    document_id: string;
    content: string;
    chunk_index: number;
    filename: string;
  }>;
  return rows.map((row) => ({
    chunkId: String(row.chunk_id),
    documentId: String(row.document_id),
    content: String(row.content),
    chunkIndex: Number(row.chunk_index),
    filename: String(row.filename),
  }));
}

export function getAdjacentChunks(
  documentId: string,
  chunkIndex: number,
  window: number,
  db: AppDatabase = getDatabase(),
): AdjacentChunk[] {
  if (window <= 0) return [];
  const minIndex = Math.max(0, chunkIndex - window);
  const maxIndex = chunkIndex + window;
  const rows = db
    .prepare(
      `SELECT chunk_index, content FROM document_chunks
       WHERE document_id = ? AND chunk_index >= ? AND chunk_index <= ?
       ORDER BY chunk_index ASC`,
    )
    .all(documentId, minIndex, maxIndex) as Array<{
    chunk_index: number;
    content: string;
  }>;
  return rows.map((row) => ({
    chunkIndex: Number(row.chunk_index),
    content: String(row.content),
  }));
}

function prepareChunkFtsInsert(db: AppDatabase): DatabaseStatement {
  return db.prepare(
    `INSERT INTO document_chunks_fts (chunk_id, document_id, content, filename)
     VALUES (?, ?, ?, ?)`,
  );
}

function insertChunkFts(statement: DatabaseStatement, row: FtsIndexRow): void {
  statement.run(row.chunkId, row.documentId, row.ftsText, row.filename);
}

function deleteChunksFtsForDocument(documentId: string, db: AppDatabase): void {
  db.prepare('DELETE FROM document_chunks_fts WHERE document_id = ?').run(documentId);
}

export function deleteDocumentData(
  id: string,
  db: AppDatabase = getDatabase(),
): boolean {
  if (!getDocument(id, db)) return false;
  const hasFts = hasDocumentChunksFts(db);
  db.transaction(() => {
    if (hasFts) deleteChunksFtsForDocument(id, db);
    db.prepare('DELETE FROM document_chunks WHERE document_id = ?').run(id);
    db.prepare('DELETE FROM documents WHERE id = ?').run(id);
  });
  return true;
}

export function insertDocumentWithChunks(
  input: InsertDocumentInput,
  db: AppDatabase = getDatabase(),
): DocumentInfo {
  const document: DocumentInfo = {
    id: uuidv4(),
    filename: input.filename,
    filepath: input.filepath,
    mimeType: input.mimeType,
    chunkCount: input.chunks.length,
    importedAt: Date.now(),
    contentHash: input.contentHash ?? null,
    embeddingModel: input.embeddingModel ?? null,
    embeddingDim: input.embeddingDim ?? null,
    summary: input.summary ?? null,
    outline: input.outline ?? null,
  };
  const hasFts = hasDocumentChunksFts(db);

  db.transaction(() => {
    db.prepare(
      `INSERT INTO documents (
         id, filename, filepath, mime_type, chunk_count, imported_at,
         content_hash, embedding_model, embedding_dim, summary, outline, embedding
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      document.id,
      document.filename,
      document.filepath,
      document.mimeType,
      document.chunkCount,
      document.importedAt,
      document.contentHash,
      document.embeddingModel,
      document.embeddingDim,
      document.summary,
      document.outline,
      input.docEmbedding ?? null,
    );

    const insertChunk = db.prepare(
      `INSERT INTO document_chunks (id, document_id, chunk_index, content, embedding)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const insertFts = hasFts ? prepareChunkFtsInsert(db) : null;
    input.chunks.forEach((chunk, index) => {
      const chunkId = uuidv4();
      insertChunk.run(chunkId, document.id, index, chunk.content, chunk.embedding);
      if (insertFts) {
        insertChunkFts(
          insertFts,
          {
            chunkId,
            documentId: document.id,
            ftsText: chunk.ftsText,
            filename: document.filename,
          },
        );
      }
    });
  });
  return document;
}

export function updateDocumentMeta(
  documentId: string,
  meta: DocumentMetaPatch,
  db: AppDatabase = getDatabase(),
): void {
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
}

export function replaceDocumentChunks(
  documentId: string,
  chunks: RagChunkInput[],
  meta?: ReplaceDocumentChunksMeta,
  db: AppDatabase = getDatabase(),
): void {
  const document = getDocument(documentId, db);
  if (!document) throw new Error('文档不存在');
  const hasFts = hasDocumentChunksFts(db);

  db.transaction(() => {
    if (hasFts) deleteChunksFtsForDocument(documentId, db);
    db.prepare('DELETE FROM document_chunks WHERE document_id = ?').run(documentId);

    const insertChunk = db.prepare(
      `INSERT INTO document_chunks (id, document_id, chunk_index, content, embedding)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const insertFts = hasFts ? prepareChunkFtsInsert(db) : null;
    chunks.forEach((chunk, index) => {
      const chunkId = uuidv4();
      insertChunk.run(chunkId, documentId, index, chunk.content, chunk.embedding);
      if (insertFts) {
        insertChunkFts(
          insertFts,
          {
            chunkId,
            documentId,
            ftsText: chunk.ftsText,
            filename: document.filename,
          },
        );
      }
    });

    const updates = ['chunk_count = ?', 'embedding_model = ?', 'embedding_dim = ?'];
    const params: unknown[] = [
      chunks.length,
      meta?.embeddingModel ?? document.embeddingModel,
      meta?.embeddingDim ?? document.embeddingDim,
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
  });
}

export function loadAllDocumentEmbeddings(
  db: AppDatabase = getDatabase(),
): DocumentEmbeddingRecord[] {
  const rows = db
    .prepare(
      `SELECT id, filename, summary, embedding FROM documents
       WHERE embedding IS NOT NULL`,
    )
    .all() as Array<{
    id: string;
    filename: string;
    summary: string | null;
    embedding: unknown;
  }>;
  return rows.map((row) => ({
    id: String(row.id),
    filename: String(row.filename),
    summary: row.summary == null ? null : String(row.summary),
    embedding: toRequiredBlob(row.embedding, `文档 ${row.id}`),
  }));
}

export function loadAllChunkEmbeddingRecords(
  db: AppDatabase = getDatabase(),
): ChunkEmbeddingRecord[] {
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
    embedding: unknown;
    filename: string;
  }>;
  return rows.map((row) => ({
    id: String(row.id),
    documentId: String(row.document_id),
    chunkIndex: Number(row.chunk_index),
    content: String(row.content),
    filename: String(row.filename),
    embedding: toRequiredBlob(row.embedding, `文档分块 ${row.id}`),
  }));
}

export function loadFtsSourceRows(
  db: AppDatabase = getDatabase(),
): FtsSourceRow[] {
  const rows = db
    .prepare(
      `SELECT c.id AS chunk_id, c.document_id, c.content, d.filename
       FROM document_chunks c
       JOIN documents d ON d.id = c.document_id`,
    )
    .all() as Array<{
    chunk_id: string;
    document_id: string;
    content: string;
    filename: string;
  }>;
  return rows.map((row) => ({
    chunkId: String(row.chunk_id),
    documentId: String(row.document_id),
    content: String(row.content),
    filename: String(row.filename),
  }));
}

export function rebuildFtsIndex(
  rows: FtsIndexRow[],
  db: AppDatabase = getDatabase(),
): boolean {
  if (!hasDocumentChunksFts(db)) return false;
  db.transaction(() => {
    db.exec('DELETE FROM document_chunks_fts');
    const insertFts = prepareChunkFtsInsert(db);
    for (const row of rows) insertChunkFts(insertFts, row);
  });
  return true;
}
