import {
  createMemoryCandidate,
  getMemoryCandidate,
  listMemoryCandidates,
  setMemoryCandidateStatus,
} from '../db/repositories/memory-candidates';
import type {
  MemoryCandidateInfo,
  MemoryCandidateStatus,
} from '../shared/types';
import { upsertMemory } from './long-term';

export {
  createMemoryCandidate,
  getMemoryCandidate,
  listMemoryCandidates,
  setMemoryCandidateStatus,
};

export async function confirmMemoryCandidate(id: string): Promise<MemoryCandidateInfo> {
  const candidate = getMemoryCandidate(id);
  if (!candidate) throw new Error('记忆候选不存在');
  if (candidate.status === 'rejected') throw new Error('该记忆候选已被拒绝');

  if (candidate.status === 'pending') {
    await upsertMemory(candidate.memoryKey, candidate.content, candidate.confidence, candidate.sourceSessionId ?? undefined, {
      skipEmbedding: true,
    });
    const confirmed = setMemoryCandidateStatus(id, 'confirmed');
    if (!confirmed) throw new Error('记忆候选在确认后消失');
    return confirmed;
  }

  return candidate;
}

export function rejectMemoryCandidate(id: string): MemoryCandidateInfo {
  const candidate = getMemoryCandidate(id);
  if (!candidate) throw new Error('记忆候选不存在');
  if (candidate.status === 'confirmed') throw new Error('该记忆候选已确认，不能拒绝');

  const rejected = setMemoryCandidateStatus(id, 'rejected');
  if (!rejected) throw new Error('记忆候选在拒绝后消失');
  return rejected;
}

export function listPendingMemoryCandidates(limit = 100): MemoryCandidateInfo[] {
  return listMemoryCandidates('pending', limit);
}

export function normalizeMemoryCandidateStatus(value: unknown): MemoryCandidateStatus {
  if (value === 'confirmed' || value === 'rejected') return value;
  return 'pending';
}
