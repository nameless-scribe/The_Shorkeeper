import fs from 'node:fs/promises';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { getWorkspaceDir } from '../config/paths';
import { getDatabase } from '../db';
import { deserializeEmbedding } from './vector';

export interface DocumentInfo {
  id: string;
  filename: string;
  filepath: string;
  mimeType: string | null;
  chunkCount: number;
  importedAt: number;
}

function rowToInfo(row: {
  id: string;
  filename: string;
  filepath: string;
  mime_type: string | null;
  chunk_count: number;
  imported_at: number;
}): DocumentInfo {
  return {
    id: row.id,
    filename: row.filename,
    filepath: row.filepath,
    mimeType: row.mime_type,
    chunkCount: row.chunk_count,
    importedAt: row.imported_at,
  };
}

export function listDocuments(): DocumentInfo[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT id, filename, filepath, mime_type, chunk_count, imported_at
       FROM documents
       ORDER BY imported_at DESC`,
    )
    .all() as Array<{
    id: string;
    filename: string;
    filepath: string;
    mime_type: string | null;
    chunk_count: number;
    imported_at: number;
  }>;

  return rows.map(rowToInfo);
}

export function getDocument(id: string): DocumentInfo | undefined {
  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT id, filename, filepath, mime_type, chunk_count, imported_at
       FROM documents WHERE id = ?`,
    )
    .get(id) as
    | {
        id: string;
        filename: string;
        filepath: string;
        mime_type: string | null;
        chunk_count: number;
        imported_at: number;
      }
    | undefined;

  return row ? rowToInfo(row) : undefined;
}

export function deleteDocument(id: string): boolean {
  const doc = getDocument(id);
  if (!doc) return false;

  const db = getDatabase();
  db.prepare('DELETE FROM document_chunks WHERE document_id = ?').run(id);
  db.prepare('DELETE FROM documents WHERE id = ?').run(id);

  const absolutePath = path.join(getWorkspaceDir(), doc.filepath);
  fs.unlink(absolutePath).catch(() => undefined);

  return true;
}

export function insertDocumentWithChunks(input: {
  filename: string;
  filepath: string;
  mimeType: string | null;
  chunks: Array<{ content: string; embedding: Uint8Array }>;
}): DocumentInfo {
  const db = getDatabase();
  const docId = uuidv4();
  const now = Date.now();

  db.prepare(
    `INSERT INTO documents (id, filename, filepath, mime_type, chunk_count, imported_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    docId,
    input.filename,
    input.filepath,
    input.mimeType,
    input.chunks.length,
    now,
  );

  const insertChunk = db.prepare(
    `INSERT INTO document_chunks (id, document_id, chunk_index, content, embedding)
     VALUES (?, ?, ?, ?, ?)`,
  );

  input.chunks.forEach((chunk, index) => {
    insertChunk.run(uuidv4(), docId, index, chunk.content, chunk.embedding);
  });

  return {
    id: docId,
    filename: input.filename,
    filepath: input.filepath,
    mimeType: input.mimeType,
    chunkCount: input.chunks.length,
    importedAt: now,
  };
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
