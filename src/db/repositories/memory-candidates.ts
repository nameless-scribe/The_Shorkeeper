import { v4 as uuidv4 } from 'uuid';
import { getDatabase, type AppDatabase } from '../index';
import type {
  MemoryCandidateCategory,
  MemoryCandidateInfo,
  MemoryCandidateStatus,
} from '../../shared/types';

export interface CreateMemoryCandidateInput {
  memoryKey: string;
  content: string;
  category: MemoryCandidateCategory;
  confidence: number;
  reason: string;
  sourceSessionId?: string | null;
}

interface MemoryCandidateRow {
  id: string;
  memory_key: string;
  content: string;
  category: string;
  confidence: number;
  reason: string;
  source_session_id: string | null;
  status: string;
  created_at: number;
  updated_at: number;
}

function normalizeStatus(value: string): MemoryCandidateStatus {
  if (value === 'confirmed' || value === 'rejected') return value;
  return 'pending';
}

function normalizeCategory(value: string): MemoryCandidateCategory {
  if (value === 'relationship' || value === 'other') return value;
  return 'stable_preference';
}

function rowToCandidate(row: MemoryCandidateRow): MemoryCandidateInfo {
  return {
    id: String(row.id),
    memoryKey: String(row.memory_key),
    content: String(row.content),
    category: normalizeCategory(String(row.category)),
    confidence: Math.max(0, Math.min(1, Number(row.confidence))),
    reason: String(row.reason),
    sourceSessionId: row.source_session_id == null ? null : String(row.source_session_id),
    status: normalizeStatus(String(row.status)),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function selectCandidateRow(
  db: AppDatabase,
  sql: string,
  ...params: unknown[]
): MemoryCandidateRow | undefined {
  return db.prepare(sql).get(...params) as MemoryCandidateRow | undefined;
}

export function createMemoryCandidate(
  input: CreateMemoryCandidateInput,
  db: AppDatabase = getDatabase(),
): MemoryCandidateInfo | null {
  const sameFact = selectCandidateRow(
    db,
    `SELECT id, memory_key, content, category, confidence, reason,
            source_session_id, status, created_at, updated_at
     FROM memory_candidates
     WHERE memory_key = ? AND content = ?
     ORDER BY created_at DESC
     LIMIT 1`,
    input.memoryKey,
    input.content,
  );

  if (sameFact) {
    // pending 不重复入队；rejected 不得自动恢复；confirmed 已写入长期记忆。
    return null;
  }

  const pendingSameKey = selectCandidateRow(
    db,
    `SELECT id, memory_key, content, category, confidence, reason,
            source_session_id, status, created_at, updated_at
     FROM memory_candidates
     WHERE memory_key = ? AND status = 'pending'
     ORDER BY created_at DESC
     LIMIT 1`,
    input.memoryKey,
  );

  const now = Date.now();
  if (pendingSameKey) {
    db.prepare(
      `UPDATE memory_candidates
       SET content = ?, category = ?, confidence = ?, reason = ?,
           source_session_id = ?, updated_at = ?
       WHERE id = ? AND status = 'pending'`,
    ).run(
      input.content,
      input.category,
      Math.max(0, Math.min(1, input.confidence)),
      input.reason,
      input.sourceSessionId ?? null,
      now,
      pendingSameKey.id,
    );
    return getMemoryCandidate(pendingSameKey.id, db);
  }

  const candidate: MemoryCandidateInfo = {
    id: uuidv4(),
    memoryKey: input.memoryKey,
    content: input.content,
    category: input.category,
    confidence: Math.max(0, Math.min(1, input.confidence)),
    reason: input.reason,
    sourceSessionId: input.sourceSessionId ?? null,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };
  db.prepare(
    `INSERT INTO memory_candidates
       (id, memory_key, content, category, confidence, reason, source_session_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
  ).run(
    candidate.id,
    candidate.memoryKey,
    candidate.content,
    candidate.category,
    candidate.confidence,
    candidate.reason,
    candidate.sourceSessionId,
    candidate.createdAt,
    candidate.updatedAt,
  );
  return candidate;
}

export function getMemoryCandidate(
  id: string,
  db: AppDatabase = getDatabase(),
): MemoryCandidateInfo | null {
  const row = db.prepare(
    `SELECT id, memory_key, content, category, confidence, reason,
            source_session_id, status, created_at, updated_at
     FROM memory_candidates WHERE id = ?`,
  ).get(id) as MemoryCandidateRow | undefined;
  return row ? rowToCandidate(row) : null;
}

export function listMemoryCandidates(
  status: MemoryCandidateStatus = 'pending',
  limit = 100,
  db: AppDatabase = getDatabase(),
): MemoryCandidateInfo[] {
  const rows = db.prepare(
    `SELECT id, memory_key, content, category, confidence, reason,
            source_session_id, status, created_at, updated_at
     FROM memory_candidates
     WHERE status = ?
     ORDER BY created_at DESC
     LIMIT ?`,
  ).all(status, Math.max(1, Math.min(500, limit))) as unknown as MemoryCandidateRow[];
  return rows.map(rowToCandidate);
}

export function setMemoryCandidateStatus(
  id: string,
  status: MemoryCandidateStatus,
  db: AppDatabase = getDatabase(),
): MemoryCandidateInfo | null {
  db.prepare(`UPDATE memory_candidates SET status = ?, updated_at = ? WHERE id = ?`).run(
    status,
    Date.now(),
    id,
  );
  return getMemoryCandidate(id, db);
}
