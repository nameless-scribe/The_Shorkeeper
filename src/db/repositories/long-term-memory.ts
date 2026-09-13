import { v4 as uuidv4 } from 'uuid';
import { getDatabase, type AppDatabase } from '../index';
import type {
  MemoryModelUsePolicy,
  MemorySensitivity,
  PersonalMemoryStatus,
  PersonalMemoryType,
} from '../../shared/types';
import {
  clampMemoryConfidence,
  MEMORY_MODEL_USE_POLICIES,
  MEMORY_SENSITIVITIES,
  PERSONAL_MEMORY_STATUSES,
  PERSONAL_MEMORY_TYPES,
} from '../../memory/personal-model';

export interface MemoryEntry {
  id: string;
  memoryKey: string | null;
  content: string;
  importance: number;
  sourceSessionId: string | null;
  memoryType: PersonalMemoryType;
  confidence: number;
  sensitivity: MemorySensitivity;
  modelUsePolicy: MemoryModelUsePolicy;
  status: PersonalMemoryStatus;
  validFrom: number;
  expiresAt: number | null;
  supersededBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryEmbeddingEntry extends MemoryEntry {
  embedding: Uint8Array | null;
}

export interface CreateMemoryInput {
  memoryKey?: string | null;
  content: string;
  importance: number;
  sourceSessionId?: string | null;
  memoryType?: PersonalMemoryType;
  confidence?: number;
  sensitivity?: MemorySensitivity;
  modelUsePolicy?: MemoryModelUsePolicy;
  status?: PersonalMemoryStatus;
  validFrom?: number;
  expiresAt?: number | null;
  supersededBy?: string | null;
  createdAt?: number;
  updatedAt?: number;
  embedding?: Uint8Array | null;
}

export interface UpdateMemoryInput {
  content: string;
  importance: number;
  sourceSessionId?: string | null;
  memoryType?: PersonalMemoryType;
  confidence?: number;
  sensitivity?: MemorySensitivity;
  modelUsePolicy?: MemoryModelUsePolicy;
  validFrom?: number;
  expiresAt?: number | null;
  createdAt?: number;
  updatedAt?: number;
  embedding: Uint8Array | null;
}

interface MemoryRow {
  id: string;
  memory_key: string | null;
  content: string;
  importance: number;
  source_session_id: string | null;
  memory_type: string;
  confidence: number;
  sensitivity: string;
  model_use_policy: string;
  status: string;
  valid_from: number | null;
  expires_at: number | null;
  superseded_by: string | null;
  created_at: number;
  updated_at: number | null;
  embedding?: unknown;
}

const MEMORY_SELECT = `id, memory_key, content, importance, source_session_id,
  memory_type, confidence, sensitivity, model_use_policy, status,
  valid_from, expires_at, superseded_by, created_at, updated_at`;

function isValue<T extends string>(values: readonly T[], value: string): value is T {
  return values.includes(value as T);
}

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
  const createdAt = Number(row.created_at);
  const memoryType = String(row.memory_type);
  const sensitivity = String(row.sensitivity);
  const modelUsePolicy = String(row.model_use_policy);
  const status = String(row.status);
  return {
    id: String(row.id),
    memoryKey: row.memory_key == null ? null : String(row.memory_key),
    content: String(row.content),
    importance: Number(row.importance),
    sourceSessionId: row.source_session_id == null ? null : String(row.source_session_id),
    memoryType: isValue(PERSONAL_MEMORY_TYPES, memoryType) ? memoryType : 'other',
    confidence: clampMemoryConfidence(Number(row.confidence)),
    sensitivity: isValue(MEMORY_SENSITIVITIES, sensitivity) ? sensitivity : 'normal',
    modelUsePolicy: isValue(MEMORY_MODEL_USE_POLICIES, modelUsePolicy)
      ? modelUsePolicy
      : 'deny',
    status: isValue(PERSONAL_MEMORY_STATUSES, status) ? status : 'disputed',
    validFrom: row.valid_from == null ? createdAt : Number(row.valid_from),
    expiresAt: row.expires_at == null ? null : Number(row.expires_at),
    supersededBy: row.superseded_by == null ? null : String(row.superseded_by),
    createdAt,
    updatedAt: row.updated_at == null ? createdAt : Number(row.updated_at),
  };
}

function rowToEmbeddingEntry(row: MemoryRow): MemoryEmbeddingEntry {
  return { ...rowToEntry(row), embedding: toEmbedding(row.embedding) };
}

function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export function listMemories(limit = 50, db: AppDatabase = getDatabase()): MemoryEntry[] {
  const rows = db.prepare(
    `SELECT ${MEMORY_SELECT} FROM long_term_memory
     WHERE status = 'active'
     ORDER BY importance DESC, created_at DESC LIMIT ?`,
  ).all(limit) as unknown as MemoryRow[];
  return rows.map(rowToEntry);
}

export function listMemoryHistory(
  memoryKey: string,
  db: AppDatabase = getDatabase(),
): MemoryEntry[] {
  const rows = db.prepare(
    `SELECT ${MEMORY_SELECT} FROM long_term_memory
     WHERE memory_key = ? ORDER BY valid_from DESC, created_at DESC`,
  ).all(memoryKey) as unknown as MemoryRow[];
  return rows.map(rowToEntry);
}

export function getMemoryByKey(
  memoryKey: string,
  db: AppDatabase = getDatabase(),
): MemoryEntry | undefined {
  const row = db.prepare(
    `SELECT ${MEMORY_SELECT} FROM long_term_memory WHERE memory_key = ? AND status = 'active'`,
  ).get(memoryKey) as unknown as MemoryRow | undefined;
  return row ? rowToEntry(row) : undefined;
}

export function getMemoryWithEmbeddingByKey(
  memoryKey: string,
  db: AppDatabase = getDatabase(),
): MemoryEmbeddingEntry | undefined {
  const row = db.prepare(
    `SELECT ${MEMORY_SELECT}, embedding FROM long_term_memory
     WHERE memory_key = ? AND status = 'active'`,
  ).get(memoryKey) as unknown as MemoryRow | undefined;
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
  const rows = db.prepare(
    `SELECT ${MEMORY_SELECT} FROM long_term_memory
     WHERE status = 'active'
       AND (content LIKE ? ESCAPE '\\' OR memory_key LIKE ? ESCAPE '\\')
     ORDER BY importance DESC, created_at DESC LIMIT ?`,
  ).all(pattern, pattern, limit) as unknown as MemoryRow[];
  return rows.map(rowToEntry);
}

export function listMemoryEmbeddings(
  limit = 200,
  db: AppDatabase = getDatabase(),
): MemoryEmbeddingEntry[] {
  const rows = db.prepare(
    `SELECT ${MEMORY_SELECT}, embedding FROM long_term_memory
     WHERE status = 'active' ORDER BY created_at DESC LIMIT ?`,
  ).all(limit) as unknown as MemoryRow[];
  return rows.map(rowToEmbeddingEntry);
}

export function createMemory(
  input: CreateMemoryInput,
  db: AppDatabase = getDatabase(),
): MemoryEntry {
  const createdAt = input.createdAt ?? Date.now();
  const entry: MemoryEntry = {
    id: uuidv4(),
    memoryKey: input.memoryKey ?? null,
    content: input.content,
    importance: input.importance,
    sourceSessionId: input.sourceSessionId ?? null,
    memoryType: input.memoryType ?? 'other',
    confidence: clampMemoryConfidence(input.confidence ?? 0.5),
    sensitivity: input.sensitivity ?? 'normal',
    modelUsePolicy: input.modelUsePolicy ?? 'allow',
    status: input.status ?? 'active',
    validFrom: input.validFrom ?? createdAt,
    expiresAt: input.expiresAt ?? null,
    supersededBy: input.supersededBy ?? null,
    createdAt,
    updatedAt: input.updatedAt ?? createdAt,
  };
  db.prepare(
    `INSERT INTO long_term_memory (${MEMORY_SELECT}, embedding)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.id, entry.memoryKey, entry.content, entry.importance, entry.sourceSessionId,
    entry.memoryType, entry.confidence, entry.sensitivity, entry.modelUsePolicy, entry.status,
    entry.validFrom, entry.expiresAt, entry.supersededBy, entry.createdAt, entry.updatedAt,
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
    memoryType: input.memoryType ?? existing.memoryType,
    confidence: clampMemoryConfidence(input.confidence ?? existing.confidence),
    sensitivity: input.sensitivity ?? existing.sensitivity,
    modelUsePolicy: input.modelUsePolicy ?? existing.modelUsePolicy,
    validFrom: input.validFrom ?? existing.validFrom,
    expiresAt: input.expiresAt === undefined ? existing.expiresAt : input.expiresAt,
    createdAt: input.createdAt ?? existing.createdAt,
    updatedAt: input.updatedAt ?? Date.now(),
  };
  db.prepare(
    `UPDATE long_term_memory SET
       content = ?, importance = ?, source_session_id = ?, memory_type = ?, confidence = ?,
       sensitivity = ?, model_use_policy = ?, valid_from = ?, expires_at = ?,
       created_at = ?, updated_at = ?, embedding = ?
     WHERE memory_key = ? AND status = 'active'`,
  ).run(
    updated.content, updated.importance, updated.sourceSessionId, updated.memoryType,
    updated.confidence, updated.sensitivity, updated.modelUsePolicy, updated.validFrom,
    updated.expiresAt, updated.createdAt, updated.updatedAt, input.embedding, memoryKey,
  );
  return updated;
}

export function updateMemoryEmbeddingByKey(
  memoryKey: string,
  embedding: Uint8Array,
  db: AppDatabase = getDatabase(),
): void {
  db.prepare(
    `UPDATE long_term_memory SET embedding = ?, updated_at = ?
     WHERE memory_key = ? AND status = 'active'`,
  ).run(embedding, Date.now(), memoryKey);
}

export function getMemoryById(
  id: string,
  db: AppDatabase = getDatabase(),
): MemoryEntry | undefined {
  const row = db.prepare(`SELECT ${MEMORY_SELECT} FROM long_term_memory WHERE id = ?`).get(id) as
    | MemoryRow
    | undefined;
  return row ? rowToEntry(row) : undefined;
}

export function updateMemoryContentById(
  id: string,
  content: string,
  embedding: Uint8Array | null,
  db: AppDatabase = getDatabase(),
): MemoryEntry | undefined {
  const existing = getMemoryById(id, db);
  if (!existing) return undefined;
  const updated = { ...existing, content, updatedAt: Date.now() };
  db.prepare(
    `UPDATE long_term_memory SET content = ?, embedding = ?, updated_at = ? WHERE id = ?`,
  ).run(updated.content, embedding, updated.updatedAt, id);
  return updated;
}

export function deleteMemoryById(
  id: string,
  db: AppDatabase = getDatabase(),
): MemoryEntry | undefined {
  const existing = getMemoryById(id, db);
  if (!existing) return undefined;
  db.prepare('DELETE FROM long_term_memory WHERE id = ?').run(id);
  return existing;
}
