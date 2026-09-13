import { runInDatabaseTransaction, type AppDatabase } from '../db/transaction';
import {
  createMemory,
  getCurrentMemoryByKey,
  getMemoryById,
  setMemoryStatusById,
  type MemoryEntry,
} from '../db/repositories/long-term-memory';
import {
  createMemoryCandidate,
  getMemoryCandidate,
  rejectMemoryFact,
  setMemoryCandidateStatus,
  type CreateMemoryCandidateInput,
} from '../db/repositories/memory-candidates';
import { createMemorySource } from '../db/repositories/memory-sources';
import { createGoal, listGoals } from '../db/repositories/goals';
import type {
  MemoryCandidateInfo,
  MemoryCandidateResolution,
  MemorySourceType,
} from '../shared/types';
import { categoryFromMemoryType } from './candidate-policy';

function recordUserRejectedFact(
  memory: MemoryEntry,
  reason: string,
  db: AppDatabase,
): void {
  if (!memory.memoryKey) return;
  rejectMemoryFact({
    memoryKey: memory.memoryKey,
    content: memory.content,
    category: categoryFromMemoryType(memory.memoryType),
    confidence: 1,
    reason,
    sourceSessionId: memory.sourceSessionId,
    memoryType: memory.memoryType,
    sensitivity: memory.sensitivity,
    modelUsePolicy: memory.modelUsePolicy,
  }, db);
}

function createSourceForCandidate(
  memoryId: string,
  candidate: MemoryCandidateInfo,
  db: AppDatabase,
): void {
  createMemorySource({
    memoryId,
    sourceType: 'conversation',
    sourceSessionId: candidate.sourceSessionId,
    sourceMessageId: candidate.sourceMessageId,
    sourceRunId: candidate.sourceRunId,
    sourceRef: candidate.sourceMessageId
      ? `conversation:${candidate.sourceSessionId ?? 'unknown'}:${candidate.sourceMessageId}`
      : candidate.sourceSessionId
        ? `conversation:${candidate.sourceSessionId}`
        : null,
    summary: candidate.reason,
  }, db);
}

function createMemoryFromCandidate(
  candidate: MemoryCandidateInfo,
  memoryKey: string,
  db: AppDatabase,
): MemoryEntry {
  const now = Date.now();
  const memory = createMemory({
    memoryKey,
    content: candidate.content,
    importance: candidate.confidence,
    sourceSessionId: candidate.sourceSessionId,
    memoryType: candidate.memoryType,
    confidence: candidate.confidence,
    sensitivity: candidate.sensitivity,
    modelUsePolicy: candidate.modelUsePolicy,
    validFrom: candidate.validFrom ?? now,
    expiresAt: candidate.expiresAt,
    createdAt: now,
    updatedAt: now,
    embedding: null,
  }, db);
  createSourceForCandidate(memory.id, candidate, db);
  return memory;
}

function confirmGoalCandidate(candidate: MemoryCandidateInfo, db: AppDatabase): void {
  const normalized = candidate.content.trim().toLowerCase();
  const exists = listGoals({ includeClosed: true, limit: 200 }, db)
    .some((goal) => goal.title.trim().toLowerCase() === normalized);
  if (!exists) {
    createGoal({
      title: candidate.content,
      targetDate: candidate.expiresAt == null
        ? null
        : new Date(candidate.expiresAt).toISOString().slice(0, 10),
    }, db);
  }
}

/** 原事实进入 disputed 与候选写入必须同生共死。 */
export function stageMemoryConflict(
  input: CreateMemoryCandidateInput & { conflictsWithMemoryId: string },
  db?: AppDatabase,
): MemoryCandidateInfo | null {
  return runInDatabaseTransaction((db) => {
    const existing = getMemoryById(input.conflictsWithMemoryId, db);
    if (!existing || (existing.status !== 'active' && existing.status !== 'disputed')) {
      return null;
    }
    const candidate = createMemoryCandidate({
      ...input,
      proposedAction: input.proposedAction ?? 'replace',
    }, db);
    if (!candidate) return null;
    if (existing.status === 'active') {
      setMemoryStatusById(existing.id, 'disputed', null, db);
    }
    return candidate;
  }, db);
}

export interface ResolveMemoryCandidateResult {
  candidate: MemoryCandidateInfo;
  memory: MemoryEntry | null;
}

/** 候选决策的唯一写入口；事务内重读状态保证重复/并发确认幂等。 */
export function resolveMemoryCandidate(
  id: string,
  resolution: MemoryCandidateResolution,
  db?: AppDatabase,
): ResolveMemoryCandidateResult {
  return runInDatabaseTransaction((db) => {
    const candidate = getMemoryCandidate(id, db);
    if (!candidate) throw new Error('记忆候选不存在');
    if (candidate.status !== 'pending') {
      return {
        candidate,
        memory: candidate.conflictsWithMemoryId
          ? getCurrentMemoryByKey(candidate.memoryKey, db) ?? null
          : null,
      };
    }

    if (resolution === 'keep_original') {
      if (candidate.conflictsWithMemoryId) {
        const original = getMemoryById(candidate.conflictsWithMemoryId, db);
        if (original?.status === 'disputed') {
          setMemoryStatusById(original.id, 'active', null, db);
        }
      }
      const rejected = setMemoryCandidateStatus(id, 'rejected', db);
      if (!rejected) throw new Error('记忆候选在保留原事实后消失');
      return { candidate: rejected, memory: null };
    }

    if (candidate.memoryType === 'goal') {
      if (candidate.conflictsWithMemoryId) {
        const legacyGoalMemory = getMemoryById(candidate.conflictsWithMemoryId, db);
        if (!legacyGoalMemory) {
          throw new Error('原事实已不存在，请刷新候选后重试');
        }
        if (resolution === 'coexist') {
          // 并存：原事实恢复 active，新目标进入目标系统。
          if (legacyGoalMemory.status === 'disputed') setMemoryStatusById(legacyGoalMemory.id, 'active', null, db);
        } else if (
          legacyGoalMemory.status === 'active' || legacyGoalMemory.status === 'disputed'
        ) {
          setMemoryStatusById(legacyGoalMemory.id, 'superseded', null, db);
        }
      }
      confirmGoalCandidate(candidate, db);
      const confirmed = setMemoryCandidateStatus(id, 'confirmed', db);
      if (!confirmed) throw new Error('目标候选在确认后消失');
      return { candidate: confirmed, memory: null };
    }

    const original = candidate.conflictsWithMemoryId
      ? getMemoryById(candidate.conflictsWithMemoryId, db)
      : undefined;
    if (candidate.conflictsWithMemoryId && !original) {
      throw new Error('原事实已不存在，请刷新候选后重试');
    }

    let memory: MemoryEntry;
    if (resolution === 'replace' && original) {
      if (original.status !== 'active' && original.status !== 'disputed') {
        throw new Error('原事实已发生变化，请刷新候选后重试');
      }
      setMemoryStatusById(original.id, 'superseded', null, db);
      memory = createMemoryFromCandidate(candidate, candidate.memoryKey, db);
      setMemoryStatusById(original.id, 'superseded', memory.id, db);
    } else if (resolution === 'coexist' && original) {
      if (original.status === 'disputed') {
        setMemoryStatusById(original.id, 'active', null, db);
      }
      const suffix = candidate.id.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase();
      const base = candidate.memoryKey.slice(0, 100);
      memory = createMemoryFromCandidate(candidate, `${base}.context_${suffix}`, db);
    } else {
      const current = getCurrentMemoryByKey(candidate.memoryKey, db);
      if (current) {
        throw new Error('同一主题已有事实，请刷新候选后选择冲突处理方式');
      }
      memory = createMemoryFromCandidate(candidate, candidate.memoryKey, db);
    }

    const confirmed = setMemoryCandidateStatus(id, 'confirmed', db);
    if (!confirmed) throw new Error('记忆候选在确认后消失');
    return { candidate: confirmed, memory };
  }, db);
}

export function replaceMemoryFromUserEdit(
  existing: MemoryEntry,
  content: string,
  db?: AppDatabase,
): MemoryEntry {
  return runInDatabaseTransaction((db) => {
    const fresh = getMemoryById(existing.id, db);
    if (!fresh || fresh.status !== 'active') throw new Error('长期记忆已发生变化，请刷新后重试');
    setMemoryStatusById(fresh.id, 'superseded', null, db);
    const now = Date.now();
    const replacement = createMemory({
      memoryKey: fresh.memoryKey,
      content,
      importance: fresh.importance,
      sourceSessionId: fresh.sourceSessionId,
      memoryType: fresh.memoryType,
      confidence: 1,
      sensitivity: fresh.sensitivity,
      modelUsePolicy: fresh.modelUsePolicy,
      validFrom: now,
      expiresAt: fresh.expiresAt,
      createdAt: now,
      updatedAt: now,
      embedding: null,
    }, db);
    setMemoryStatusById(fresh.id, 'superseded', replacement.id, db);
    createMemorySource({
      memoryId: replacement.id,
      sourceType: 'user_edit' satisfies MemorySourceType,
      sourceRef: `memory-edit:${fresh.id}`,
      summary: '用户从设置中修改长期记忆',
      createdAt: now,
    }, db);
    recordUserRejectedFact(fresh, '用户从设置中修改', db);
    return replacement;
  }, db);
}

export function rejectMemoryByUser(
  id: string,
  db?: AppDatabase,
): MemoryEntry {
  return runInDatabaseTransaction((db) => {
    const existing = getMemoryById(id, db);
    if (!existing || existing.status !== 'active') throw new Error('长期记忆不存在');
    const rejected = setMemoryStatusById(id, 'rejected', null, db);
    if (!rejected) throw new Error('长期记忆在删除后消失');
    recordUserRejectedFact(existing, '用户从设置中删除', db);
    return rejected;
  }, db);
}
