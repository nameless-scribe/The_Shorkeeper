import { v4 as uuidv4 } from 'uuid';
import { getDatabase, type AppDatabase, type DatabaseStatement } from '../index';
import type {
  DocumentFreshnessStatus,
  DocumentSourceKind,
  DocumentSyncPolicy,
} from '../../shared/types';
import { notifyLocalStateChanged } from '../../proactivity/signals';

export type DocumentStatus =
  | 'importing'
  | 'indexed'
  | 'index_failed'
  | 'needs_rebuild'
  | 'superseded'
  | 'deleted';

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
  status: DocumentStatus;
  statusError: string | null;
  updatedAt: number;
  indexedAt: number | null;
  deletedAt: number | null;
  sourcePath: string | null;
  title: string;
  titleKey: string;
  version: number;
  supersededBy: string | null;
  chunkSize: number;
  chunkOverlap: number;
  sourceKind: DocumentSourceKind;
  sourceModifiedAt: number | null;
  sourceSize: number | null;
  lastCheckedAt: number | null;
  freshnessStatus: DocumentFreshnessStatus;
  staleReason: string | null;
  syncPolicy: DocumentSyncPolicy;
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
}

export interface DocumentMetaPatch {
  summary?: string | null;
  outline?: string | null;
  docEmbedding?: Uint8Array | null;
  embeddingModel?: string | null;
  embeddingDim?: number | null;
  status?: DocumentStatus;
  statusError?: string | null;
  indexedAt?: number | null;
  deletedAt?: number | null;
  sourceModifiedAt?: number | null;
  sourceSize?: number | null;
  lastCheckedAt?: number | null;
  freshnessStatus?: DocumentFreshnessStatus;
  staleReason?: string | null;
  syncPolicy?: DocumentSyncPolicy;
  sourcePath?: string | null;
  sourceKind?: DocumentSourceKind;
}

export interface ReplaceDocumentChunksMeta extends DocumentMetaPatch {
  embeddingModel?: string;
  embeddingDim?: number;
  supersedeDocumentIds?: string[];
  chunkSize?: number;
  chunkOverlap?: number;
}

export interface DocumentVersionPlan {
  version: number;
  previousDocumentIds: string[];
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
  status?: DocumentStatus | null;
  status_error?: string | null;
  updated_at?: number | null;
  indexed_at?: number | null;
  deleted_at?: number | null;
  source_path?: string | null;
  title?: string | null;
  title_key?: string | null;
  document_version?: number | null;
  superseded_by?: string | null;
  chunk_size?: number | null;
  chunk_overlap?: number | null;
  source_kind?: string | null;
  source_modified_at?: number | null;
  source_size?: number | null;
  last_checked_at?: number | null;
  freshness_status?: string | null;
  stale_reason?: string | null;
  sync_policy?: string | null;
}

const DOCUMENT_SELECT =
  `id, filename, filepath, mime_type, chunk_count, imported_at, content_hash,
   embedding_model, embedding_dim, summary, outline, status, status_error,
   updated_at, indexed_at, deleted_at, source_path, title, title_key,
   document_version, superseded_by, chunk_size, chunk_overlap, source_kind,
   source_modified_at, source_size, last_checked_at, freshness_status,
   stale_reason, sync_policy`;

function normalizeSourceKind(value: string | null | undefined): DocumentSourceKind {
  return value === 'local_file' ? 'local_file' : 'snapshot';
}

function normalizeFreshnessStatus(value: string | null | undefined): DocumentFreshnessStatus {
  if (value === 'unknown' || value === 'current' || value === 'changed' || value === 'missing') {
    return value;
  }
  return 'snapshot';
}

function normalizeSyncPolicy(value: string | null | undefined): DocumentSyncPolicy {
  return value === 'auto' ? 'auto' : 'manual';
}

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
    status: row.status ?? 'indexed',
    statusError: row.status_error == null ? null : String(row.status_error),
    updatedAt: Number(row.updated_at ?? row.imported_at),
    indexedAt: row.indexed_at == null ? null : Number(row.indexed_at),
    deletedAt: row.deleted_at == null ? null : Number(row.deleted_at),
    sourcePath: row.source_path == null ? null : String(row.source_path),
    title: row.title == null ? String(row.filename) : String(row.title),
    titleKey:
      row.title_key == null
        ? String(row.filename).toLocaleLowerCase()
        : String(row.title_key),
    version: Number(row.document_version ?? 1),
    supersededBy: row.superseded_by == null ? null : String(row.superseded_by),
    chunkSize: Number(row.chunk_size ?? 800),
    chunkOverlap: Number(row.chunk_overlap ?? 64),
    sourceKind: normalizeSourceKind(row.source_kind),
    sourceModifiedAt: row.source_modified_at == null ? null : Number(row.source_modified_at),
    sourceSize: row.source_size == null ? null : Number(row.source_size),
    lastCheckedAt: row.last_checked_at == null ? null : Number(row.last_checked_at),
    freshnessStatus: normalizeFreshnessStatus(row.freshness_status),
    staleReason: row.stale_reason == null ? null : String(row.stale_reason),
    syncPolicy: normalizeSyncPolicy(row.sync_policy),
  };
}

export function findDocumentByContentHash(
  hash: string,
  db: AppDatabase = getDatabase(),
): DocumentInfo | undefined {
  const row = db
    .prepare(
      `SELECT ${DOCUMENT_SELECT} FROM documents
       WHERE content_hash = ?
         AND status IN ('importing', 'indexed', 'index_failed', 'needs_rebuild')
       ORDER BY imported_at DESC LIMIT 1`,
    )
    .get(hash) as unknown as DocumentRow | undefined;
  return row ? rowToDocument(row) : undefined;
}

export function getDocumentVersionPlan(
  identity: { sourcePath?: string | null; titleKey: string },
  db: AppDatabase = getDatabase(),
): DocumentVersionPlan {
  const where = identity.sourcePath
    ? 'source_path = ?'
    : 'source_path IS NULL AND title_key = ?';
  const identityValue = identity.sourcePath ?? identity.titleKey;
  const rows = db
    .prepare(
      `SELECT id, status, document_version
       FROM documents
       WHERE ${where} AND status <> 'deleted'
       ORDER BY document_version DESC, imported_at DESC`,
    )
    .all(identityValue) as Array<{
    id: string;
    status: DocumentStatus;
    document_version: number;
  }>;
  const highestVersion = rows.reduce(
    (highest, row) => Math.max(highest, Number(row.document_version ?? 1)),
    0,
  );
  return {
    version: highestVersion + 1,
    previousDocumentIds: rows
      .filter((row) => row.status !== 'superseded')
      .map((row) => String(row.id)),
  };
}

export function getPreviousDocumentVersionIds(
  documentId: string,
  db: AppDatabase = getDatabase(),
): string[] {
  const document = getDocumentIncludingDeleted(documentId, db);
  if (!document) return [];
  const where = document.sourcePath
    ? 'source_path = ?'
    : 'source_path IS NULL AND title_key = ?';
  const identityValue = document.sourcePath ?? document.titleKey;
  const rows = db
    .prepare(
      `SELECT id FROM documents
       WHERE ${where}
         AND id <> ?
         AND document_version < ?
         AND status NOT IN ('deleted', 'superseded')`,
    )
    .all(identityValue, documentId, document.version) as Array<{ id: string }>;
  return rows.map((row) => String(row.id));
}

export function getStoredEmbeddingDimensions(
  db: AppDatabase = getDatabase(),
): number[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT embedding_dim AS dim FROM documents
       WHERE status = 'indexed' AND embedding_dim IS NOT NULL AND embedding_dim > 0`,
    )
    .all() as Array<{ dim: number }>;
  return rows.map((row) => Number(row.dim));
}

export function listDocuments(db: AppDatabase = getDatabase()): DocumentInfo[] {
  const rows = db
    .prepare(
      `SELECT ${DOCUMENT_SELECT} FROM documents
       WHERE status NOT IN ('deleted', 'superseded') ORDER BY imported_at DESC`,
    )
    .all() as unknown as DocumentRow[];
  return rows.map(rowToDocument);
}

export function listIndexedDocuments(db: AppDatabase = getDatabase()): DocumentInfo[] {
  const rows = db
    .prepare(
      `SELECT ${DOCUMENT_SELECT} FROM documents
       WHERE status = 'indexed' ORDER BY imported_at DESC`,
    )
    .all() as unknown as DocumentRow[];
  return rows.map(rowToDocument);
}

export function getDocument(
  id: string,
  db: AppDatabase = getDatabase(),
): DocumentInfo | undefined {
  const row = db
    .prepare(
      `SELECT ${DOCUMENT_SELECT} FROM documents
       WHERE id = ? AND status NOT IN ('deleted', 'superseded')`,
    )
    .get(id) as unknown as DocumentRow | undefined;
  return row ? rowToDocument(row) : undefined;
}

export function getDocumentIncludingDeleted(
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
        ` AND document_chunks_fts.document_id IN (${documentIds.map(() => '?').join(',')})`
      : '';
    const params =
      documentIds?.length ? [matchQuery, ...documentIds, limit] : [matchQuery, limit];
    const rows = db
      .prepare(
        `SELECT document_chunks_fts.chunk_id, bm25(document_chunks_fts) AS rank
         FROM document_chunks_fts
         JOIN documents d ON d.id = document_chunks_fts.document_id
         WHERE document_chunks_fts MATCH ? AND d.status = 'indexed'${docFilter}
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
       WHERE d.status = 'indexed' AND dc.id IN (${placeholders})`,
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
       WHERE document_id = ?
         AND EXISTS (
           SELECT 1 FROM documents
           WHERE documents.id = document_chunks.document_id
             AND documents.status = 'indexed'
         )
         AND chunk_index >= ? AND chunk_index <= ?
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

export function getDocumentChunk(
  documentId: string,
  chunkIndex: number,
  db: AppDatabase = getDatabase(),
): { chunkIndex: number; content: string } | null {
  const row = db.prepare(
    `SELECT chunk_index, content FROM document_chunks
     WHERE document_id = ? AND chunk_index = ? LIMIT 1`,
  ).get(documentId, chunkIndex) as { chunk_index: number; content: string } | undefined;
  return row ? { chunkIndex: Number(row.chunk_index), content: String(row.content) } : null;
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
  const document = getDocument(id, db);
  if (!document || document.status === 'deleted') return false;
  const hasFts = hasDocumentChunksFts(db);
  const now = Date.now();
  db.transaction(() => {
    if (hasFts) deleteChunksFtsForDocument(id, db);
    db.prepare('DELETE FROM document_chunks WHERE document_id = ?').run(id);
    db.prepare(
      `UPDATE documents
       SET status = 'deleted', status_error = NULL, chunk_count = 0,
           embedding = NULL, deleted_at = ?, updated_at = ?
       WHERE id = ?`,
    ).run(now, now, id);
  });
  return true;
}

export function insertDocumentWithChunks(
  input: InsertDocumentInput,
  db: AppDatabase = getDatabase(),
): DocumentInfo {
  const now = Date.now();
  const status = input.status ?? 'indexed';
  const document: DocumentInfo = {
    id: uuidv4(),
    filename: input.filename,
    filepath: input.filepath,
    mimeType: input.mimeType,
    chunkCount: input.chunks.length,
    importedAt: now,
    contentHash: input.contentHash ?? null,
    embeddingModel: input.embeddingModel ?? null,
    embeddingDim: input.embeddingDim ?? null,
    summary: input.summary ?? null,
    outline: input.outline ?? null,
    status,
    statusError: input.statusError ?? null,
    updatedAt: now,
    indexedAt: status === 'indexed' ? now : null,
    deletedAt: status === 'deleted' ? now : null,
    sourcePath: input.sourcePath ?? null,
    title: input.title ?? input.filename,
    titleKey: input.titleKey ?? (input.title ?? input.filename).toLocaleLowerCase(),
    version: input.version ?? 1,
    supersededBy: null,
    chunkSize: input.chunkSize ?? 800,
    chunkOverlap: input.chunkOverlap ?? 64,
    sourceKind: input.sourceKind ?? (input.sourcePath ? 'local_file' : 'snapshot'),
    sourceModifiedAt: input.sourceModifiedAt ?? null,
    sourceSize: input.sourceSize ?? null,
    lastCheckedAt: input.lastCheckedAt ?? null,
    freshnessStatus: input.freshnessStatus ?? (input.sourcePath ? 'unknown' : 'snapshot'),
    staleReason: input.staleReason ?? null,
    syncPolicy: input.syncPolicy ?? 'manual',
  };
  const hasFts = hasDocumentChunksFts(db);

  db.transaction(() => {
    db.prepare(
      `INSERT INTO documents (
         id, filename, filepath, mime_type, chunk_count, imported_at,
         content_hash, embedding_model, embedding_dim, summary, outline, embedding,
         status, status_error, updated_at, indexed_at, deleted_at,
         source_path, title, title_key, document_version, superseded_by,
         chunk_size, chunk_overlap, source_kind, source_modified_at, source_size,
         last_checked_at, freshness_status, stale_reason, sync_policy
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      document.status,
      document.statusError,
      document.updatedAt,
      document.indexedAt,
      document.deletedAt,
      document.sourcePath,
      document.title,
      document.titleKey,
      document.version,
      document.supersededBy,
      document.chunkSize,
      document.chunkOverlap,
      document.sourceKind,
      document.sourceModifiedAt,
      document.sourceSize,
      document.lastCheckedAt,
      document.freshnessStatus,
      document.staleReason,
      document.syncPolicy,
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
  if (meta.status !== undefined) {
    sets.push('status = ?');
    params.push(meta.status);
  }
  if (meta.statusError !== undefined) {
    sets.push('status_error = ?');
    params.push(meta.statusError);
  }
  if (meta.indexedAt !== undefined) {
    sets.push('indexed_at = ?');
    params.push(meta.indexedAt);
  }
  if (meta.deletedAt !== undefined) {
    sets.push('deleted_at = ?');
    params.push(meta.deletedAt);
  }
  if (meta.sourcePath !== undefined) {
    sets.push('source_path = ?');
    params.push(meta.sourcePath);
  }
  if (meta.sourceKind !== undefined) {
    sets.push('source_kind = ?');
    params.push(meta.sourceKind);
  }
  if (meta.sourceModifiedAt !== undefined) {
    sets.push('source_modified_at = ?');
    params.push(meta.sourceModifiedAt);
  }
  if (meta.sourceSize !== undefined) {
    sets.push('source_size = ?');
    params.push(meta.sourceSize);
  }
  if (meta.lastCheckedAt !== undefined) {
    sets.push('last_checked_at = ?');
    params.push(meta.lastCheckedAt);
  }
  if (meta.freshnessStatus !== undefined) {
    sets.push('freshness_status = ?');
    params.push(meta.freshnessStatus);
  }
  if (meta.staleReason !== undefined) {
    sets.push('stale_reason = ?');
    params.push(meta.staleReason);
  }
  if (meta.syncPolicy !== undefined) {
    sets.push('sync_policy = ?');
    params.push(meta.syncPolicy);
  }
  if (!sets.length) return;
  sets.push('updated_at = ?');
  params.push(Date.now());
  params.push(documentId);
  db.prepare(
    `UPDATE documents SET ${sets.join(', ')}
     WHERE id = ? AND status NOT IN ('deleted', 'superseded')`,
  ).run(...params);
  if (
    meta.freshnessStatus !== undefined ||
    meta.status !== undefined ||
    meta.staleReason !== undefined ||
    meta.deletedAt !== undefined
  ) {
    notifyLocalStateChanged('document');
  }
}

export function recoverInterruptedDocumentImports(
  db: AppDatabase = getDatabase(),
): number {
  const interrupted = db
    .prepare("SELECT COUNT(*) AS count FROM documents WHERE status = 'importing'")
    .get() as { count?: number } | undefined;
  const count = Number(interrupted?.count ?? 0);
  if (!count) return 0;
  db.prepare(
    `UPDATE documents
     SET status = 'needs_rebuild',
         status_error = '上次导入被中断，请重新构建索引',
         updated_at = ?
     WHERE status = 'importing'`,
  ).run(Date.now());
  return count;
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

    const updates = [
      'chunk_count = ?',
      'embedding_model = ?',
      'embedding_dim = ?',
      'chunk_size = ?',
      'chunk_overlap = ?',
      "status = 'indexed'",
      'status_error = NULL',
      'indexed_at = ?',
      'deleted_at = NULL',
      'updated_at = ?',
    ];
    const now = Date.now();
    const params: unknown[] = [
      chunks.length,
      meta?.embeddingModel ?? document.embeddingModel,
      meta?.embeddingDim ?? document.embeddingDim,
      meta?.chunkSize ?? document.chunkSize,
      meta?.chunkOverlap ?? document.chunkOverlap,
      now,
      now,
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

    const previousIds = [...new Set(meta?.supersedeDocumentIds ?? [])]
      .filter((id) => id !== documentId);
    if (previousIds.length) {
      const placeholders = previousIds.map(() => '?').join(',');
      db.prepare(
        `UPDATE documents
         SET status = 'superseded', status_error = NULL,
             superseded_by = ?, updated_at = ?
         WHERE id IN (${placeholders})
           AND status NOT IN ('deleted', 'superseded')`,
      ).run(documentId, now, ...previousIds);
    }
  });
}

export function loadAllDocumentEmbeddings(
  db: AppDatabase = getDatabase(),
): DocumentEmbeddingRecord[] {
  const rows = db
    .prepare(
      `SELECT id, filename, summary, embedding FROM documents
       WHERE status = 'indexed' AND embedding IS NOT NULL`,
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
       JOIN documents d ON d.id = c.document_id
       WHERE d.status = 'indexed'`,
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
       JOIN documents d ON d.id = c.document_id
       WHERE d.status = 'indexed'`,
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
