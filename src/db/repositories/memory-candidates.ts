import { v4 as uuidv4 } from 'uuid';
import { getDatabase, type AppDatabase } from '../index';
import type {
  MemoryCandidateCategory,
  MemoryCandidateInfo,
  MemoryCandidateStatus,
  MemoryModelUsePolicy,
  MemoryProposedAction,
  MemorySensitivity,
  PersonalMemoryType,
} from '../../shared/types';
import {
  MEMORY_MODEL_USE_POLICIES,
  MEMORY_PROPOSED_ACTIONS,
  MEMORY_SENSITIVITIES,
  PERSONAL_MEMORY_TYPES,
  clampMemoryConfidence,
  memoryTypeFromCandidateCategory,
} from '../../memory/personal-model';

export interface CreateMemoryCandidateInput {
  memoryKey: string;
  content: string;
  category: MemoryCandidateCategory;
  confidence: number;
  reason: string;
  sourceSessionId?: string | null;
  sourceMessageId?: string | null;
  sourceRunId?: string | null;
  memoryType?: PersonalMemoryType;
  sensitivity?: MemorySensitivity;
  modelUsePolicy?: MemoryModelUsePolicy;
  validFrom?: number | null;
  expiresAt?: number | null;
  conflictsWithMemoryId?: string | null;
  proposedAction?: MemoryProposedAction;
}

interface MemoryCandidateRow {
  id: string;
  memory_key: string;
  content: string;
  category: string;
  confidence: number;
  reason: string;
  source_session_id: string | null;
  source_message_id: string | null;
  source_run_id: string | null;
  memory_type: string;
  sensitivity: string;
  model_use_policy: string;
  valid_from: number | null;
  expires_at: number | null;
  conflicts_with_memory_id: string | null;
  proposed_action: string;
  status: string;
  created_at: number;
  updated_at: number;
}

const CANDIDATE_SELECT = `id, memory_key, content, category, confidence, reason,
  source_session_id, source_message_id, source_run_id, memory_type, sensitivity,
  model_use_policy, valid_from, expires_at, conflicts_with_memory_id,
  proposed_action, status, created_at, updated_at`;

function isValue<T extends string>(values: readonly T[], value: string): value is T {
  return values.includes(value as T);
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
  const category = normalizeCategory(String(row.category));
  const memoryType = String(row.memory_type);
  const sensitivity = String(row.sensitivity);
  const modelUsePolicy = String(row.model_use_policy);
  const proposedAction = String(row.proposed_action);
  return {
    id: String(row.id),
    memoryKey: String(row.memory_key),
    content: String(row.content),
    category,
    confidence: clampMemoryConfidence(Number(row.confidence)),
    reason: String(row.reason),
    sourceSessionId: row.source_session_id == null ? null : String(row.source_session_id),
    sourceMessageId: row.source_message_id == null ? null : String(row.source_message_id),
    sourceRunId: row.source_run_id == null ? null : String(row.source_run_id),
    memoryType: isValue(PERSONAL_MEMORY_TYPES, memoryType)
      ? memoryType
      : memoryTypeFromCandidateCategory(category),
    sensitivity: isValue(MEMORY_SENSITIVITIES, sensitivity) ? sensitivity : 'normal',
    modelUsePolicy: isValue(MEMORY_MODEL_USE_POLICIES, modelUsePolicy)
      ? modelUsePolicy
      : 'deny',
    validFrom: row.valid_from == null ? null : Number(row.valid_from),
    expiresAt: row.expires_at == null ? null : Number(row.expires_at),
    conflictsWithMemoryId: row.conflicts_with_memory_id == null
      ? null
      : String(row.conflicts_with_memory_id),
    proposedAction: isValue(MEMORY_PROPOSED_ACTIONS, proposedAction)
      ? proposedAction
      : 'create',
    status: normalizeStatus(String(row.status)),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function buildCandidate(
  input: CreateMemoryCandidateInput,
  status: MemoryCandidateStatus,
  now: number,
): MemoryCandidateInfo {
  return {
    id: uuidv4(),
    memoryKey: input.memoryKey,
    content: input.content,
    category: input.category,
    confidence: clampMemoryConfidence(input.confidence),
    reason: input.reason,
    sourceSessionId: input.sourceSessionId ?? null,
    sourceMessageId: input.sourceMessageId ?? null,
    sourceRunId: input.sourceRunId ?? null,
    memoryType: input.memoryType ?? memoryTypeFromCandidateCategory(input.category),
    sensitivity: input.sensitivity ?? 'normal',
    modelUsePolicy: input.modelUsePolicy ?? 'allow',
    validFrom: input.validFrom ?? null,
    expiresAt: input.expiresAt ?? null,
    conflictsWithMemoryId: input.conflictsWithMemoryId ?? null,
    proposedAction: input.proposedAction ?? 'create',
    status,
    createdAt: now,
    updatedAt: now,
  };
}

function selectCandidateRow(
  db: AppDatabase,
  sql: string,
  ...params: unknown[]
): MemoryCandidateRow | undefined {
  return db.prepare(sql).get(...params) as MemoryCandidateRow | undefined;
}

function insertCandidate(candidate: MemoryCandidateInfo, db: AppDatabase): void {
  db.prepare(
    `INSERT INTO memory_candidates (${CANDIDATE_SELECT})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    candidate.id, candidate.memoryKey, candidate.content, candidate.category,
    candidate.confidence, candidate.reason, candidate.sourceSessionId,
    candidate.sourceMessageId, candidate.sourceRunId, candidate.memoryType,
    candidate.sensitivity, candidate.modelUsePolicy, candidate.validFrom,
    candidate.expiresAt, candidate.conflictsWithMemoryId, candidate.proposedAction,
    candidate.status, candidate.createdAt, candidate.updatedAt,
  );
}

export function createMemoryCandidate(
  input: CreateMemoryCandidateInput,
  db: AppDatabase = getDatabase(),
): MemoryCandidateInfo | null {
  const sameFact = selectCandidateRow(
    db,
    `SELECT ${CANDIDATE_SELECT} FROM memory_candidates
     WHERE memory_key = ? AND content = ? ORDER BY created_at DESC LIMIT 1`,
    input.memoryKey,
    input.content,
  );
  if (sameFact) return null;

  const pendingSameKey = selectCandidateRow(
    db,
    `SELECT ${CANDIDATE_SELECT} FROM memory_candidates
     WHERE memory_key = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`,
    input.memoryKey,
  );

  const now = Date.now();
  const draft = buildCandidate(input, 'pending', now);
  if (pendingSameKey) {
    db.prepare(
      `UPDATE memory_candidates SET
         content = ?, category = ?, confidence = ?, reason = ?, source_session_id = ?,
         source_message_id = ?, source_run_id = ?, memory_type = ?, sensitivity = ?,
         model_use_policy = ?, valid_from = ?, expires_at = ?,
         conflicts_with_memory_id = ?, proposed_action = ?, updated_at = ?
       WHERE id = ? AND status = 'pending'`,
    ).run(
      draft.content, draft.category, draft.confidence, draft.reason, draft.sourceSessionId,
      draft.sourceMessageId, draft.sourceRunId, draft.memoryType, draft.sensitivity,
      draft.modelUsePolicy, draft.validFrom, draft.expiresAt, draft.conflictsWithMemoryId,
      draft.proposedAction, now, pendingSameKey.id,
    );
    return getMemoryCandidate(pendingSameKey.id, db);
  }

  insertCandidate(draft, db);
  return draft;
}

export function getMemoryCandidate(
  id: string,
  db: AppDatabase = getDatabase(),
): MemoryCandidateInfo | null {
  const row = db.prepare(
    `SELECT ${CANDIDATE_SELECT} FROM memory_candidates WHERE id = ?`,
  ).get(id) as MemoryCandidateRow | undefined;
  return row ? rowToCandidate(row) : null;
}

export function listMemoryCandidates(
  status: MemoryCandidateStatus = 'pending',
  limit = 100,
  db: AppDatabase = getDatabase(),
): MemoryCandidateInfo[] {
  const rows = db.prepare(
    `SELECT ${CANDIDATE_SELECT} FROM memory_candidates
     WHERE status = ? ORDER BY created_at DESC LIMIT ?`,
  ).all(status, Math.max(1, Math.min(500, limit))) as unknown as MemoryCandidateRow[];
  return rows.map(rowToCandidate);
}

export function setMemoryCandidateStatus(
  id: string,
  status: MemoryCandidateStatus,
  db: AppDatabase = getDatabase(),
): MemoryCandidateInfo | null {
  db.prepare('UPDATE memory_candidates SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, Date.now(), id);
  return getMemoryCandidate(id, db);
}

export function hasRejectedMemoryFact(
  memoryKey: string,
  content: string,
  db: AppDatabase = getDatabase(),
): boolean {
  return Boolean(selectCandidateRow(
    db,
    `SELECT ${CANDIDATE_SELECT} FROM memory_candidates
     WHERE memory_key = ? AND content = ? AND status = 'rejected' LIMIT 1`,
    memoryKey,
    content,
  ));
}

/** 用户删除长期记忆后，阻止自动提取再恢复同一条事实。 */
export function rejectMemoryFact(
  input: CreateMemoryCandidateInput,
  db: AppDatabase = getDatabase(),
): MemoryCandidateInfo {
  const existing = selectCandidateRow(
    db,
    `SELECT ${CANDIDATE_SELECT} FROM memory_candidates
     WHERE memory_key = ? AND content = ? ORDER BY created_at DESC LIMIT 1`,
    input.memoryKey,
    input.content,
  );
  if (existing) {
    const current = rowToCandidate(existing);
    if (current.status === 'rejected') return current;
    const rejected = setMemoryCandidateStatus(current.id, 'rejected', db);
    if (!rejected) throw new Error('记忆候选在拒绝后消失');
    return rejected;
  }

  const candidate = buildCandidate(input, 'rejected', Date.now());
  insertCandidate(candidate, db);
  return candidate;
}
