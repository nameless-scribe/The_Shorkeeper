import { v4 as uuidv4 } from 'uuid';
import { getDatabase, type AppDatabase } from '../index';

export interface MemoryEntry {
  id: string;
  memoryKey: string | null;
  content: string;
  importance: number;
  sourceSessionId: string | null;
  createdAt: number;
}

export interface MemoryEmbeddingEntry extends MemoryEntry {
  embedding: Uint8Array | null;
}

export interface CreateMemoryInput {
  memoryKey?: string | null;
  content: string;
  importance: number;
  sourceSessionId?: string | null;
  createdAt?: number;
  embedding?: Uint8Array | null;
}

export interface UpdateMemoryInput {
  content: string;
  importance: number;
  sourceSessionId?: string | null;
  createdAt?: number;
  embedding: Uint8Array | null;
}

interface MemoryRow {
  id: string;
  memory_key: string | null;
  content: string;
  importance: number;
  source_session_id: string | null;
  created_at: number;
  embedding?: unknown;
}

const MEMORY_SELECT =
  'id, memory_key, content, importance, source_session_id, created_at';

function toEmbedding(value: unknown): Uint8Array | null {
  if (value == null) return null;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}

function rowToEntry(row: MemoryRow): MemoryEntry {
  return {
    id: String(row.id),
    memoryKey: row.memory_key == null ? null : String(row.memory_key),
    content: String(row.content),
    importance: Number(row.importance),
    sourceSessionId:
      row.source_session_id == null ? null : String(row.source_session_id),
    createdAt: Number(row.created_at),
  };
}

function rowToEmbeddingEntry(row: MemoryRow): MemoryEmbeddingEntry {
  return { ...rowToEntry(row), embedding: toEmbedding(row.embedding) };
}

function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export function listMemories(
  limit = 50,
  db: AppDatabase = getDatabase(),
): MemoryEntry[] {
  const rows = db
    .prepare(
      `SELECT ${MEMORY_SELECT}
       FROM long_term_memory
       ORDER BY importance DESC, created_at DESC
       LIMIT ?`,
    )
    .all(limit) as unknown as MemoryRow[];
  return rows.map(rowToEntry);
}

export function getMemoryByKey(
  memoryKey: string,
  db: AppDatabase = getDatabase(),
): MemoryEntry | undefined {
  const row = db
    .prepare(`SELECT ${MEMORY_SELECT} FROM long_term_memory WHERE memory_key = ?`)
    .get(memoryKey) as unknown as MemoryRow | undefined;
  return row ? rowToEntry(row) : undefined;
}

export function getMemoryWithEmbeddingByKey(
  memoryKey: string,
  db: AppDatabase = getDatabase(),
): MemoryEmbeddingEntry | undefined {
  const row = db
    .prepare(
      `SELECT ${MEMORY_SELECT}, embedding FROM long_term_memory WHERE memory_key = ?`,
    )
    .get(memoryKey) as unknown as MemoryRow | undefined;
  return row ? rowToEmbeddingEntry(row) : undefined;
}

export function searchMemoryEntries(
  query: string,
  limit = 5,
  db: AppDatabase = getDatabase(),
): MemoryEntry[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const pattern = `%${escapeLikePattern(trimmed)}%`;
  const rows = db
    .prepare(
      `SELECT ${MEMORY_SELECT}
       FROM long_term_memory
       WHERE content LIKE ? ESCAPE '\\' OR memory_key LIKE ? ESCAPE '\\'
       ORDER BY importance DESC, created_at DESC
       LIMIT ?`,
    )
    .all(pattern, pattern, limit) as unknown as MemoryRow[];
  return rows.map(rowToEntry);
}

export function listMemoryEmbeddings(
  limit = 200,
  db: AppDatabase = getDatabase(),
): MemoryEmbeddingEntry[] {
  const rows = db
    .prepare(
      `SELECT ${MEMORY_SELECT}, embedding
       FROM long_term_memory
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(limit) as unknown as MemoryRow[];
  return rows.map(rowToEmbeddingEntry);
}

export function createMemory(
  input: CreateMemoryInput,
  db: AppDatabase = getDatabase(),
): MemoryEntry {
  const entry: MemoryEntry = {
    id: uuidv4(),
    memoryKey: input.memoryKey ?? null,
    content: input.content,
    importance: input.importance,
    sourceSessionId: input.sourceSessionId ?? null,
    createdAt: input.createdAt ?? Date.now(),
  };
  db.prepare(
    `INSERT INTO long_term_memory
       (id, memory_key, content, importance, source_session_id, created_at, embedding)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.id,
    entry.memoryKey,
    entry.content,
    entry.importance,
    entry.sourceSessionId,
    entry.createdAt,
    input.embedding ?? null,
  );
  return entry;
}

export function updateMemoryByKey(
  memoryKey: string,
  input: UpdateMemoryInput,
  db: AppDatabase = getDatabase(),
): MemoryEntry | undefined {
  const existing = getMemoryByKey(memoryKey, db);
  if (!existing) return undefined;

  const updated: MemoryEntry = {
    ...existing,
    content: input.content,
    importance: input.importance,
    sourceSessionId: input.sourceSessionId ?? null,
    createdAt: input.createdAt ?? Date.now(),
  };
  db.prepare(
    `UPDATE long_term_memory
     SET content = ?, importance = ?, source_session_id = ?, created_at = ?, embedding = ?
     WHERE memory_key = ?`,
  ).run(
    updated.content,
    updated.importance,
    updated.sourceSessionId,
    updated.createdAt,
    input.embedding,
    memoryKey,
  );
  return updated;
}

export function updateMemoryEmbeddingByKey(
  memoryKey: string,
  embedding: Uint8Array,
  db: AppDatabase = getDatabase(),
): void {
  db.prepare('UPDATE long_term_memory SET embedding = ? WHERE memory_key = ?').run(
    embedding,
    memoryKey,
  );
}
