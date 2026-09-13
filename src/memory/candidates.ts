import {
  createMemoryCandidate,
  getMemoryCandidate,
  listMemoryCandidates,
  setMemoryCandidateStatus,
} from '../db/repositories/memory-candidates';
import type {
  MemoryCandidateResolution,
  MemoryCandidateInfo,
  MemoryCandidateStatus,
} from '../shared/types';
import {
  resolveMemoryCandidate as applyMemoryCandidateResolution,
} from './personal-memory-service';

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
    if (candidate.conflictsWithMemoryId) {
      throw new Error('该候选与现有事实冲突，请明确选择保留、替换或并存');
    }
    return applyMemoryCandidateResolution(id, 'replace').candidate;
  }

  return candidate;
}

export function rejectMemoryCandidate(id: string): MemoryCandidateInfo {
  const candidate = getMemoryCandidate(id);
  if (!candidate) throw new Error('记忆候选不存在');
  if (candidate.status === 'confirmed') throw new Error('该记忆候选已确认，不能拒绝');

  return applyMemoryCandidateResolution(id, 'keep_original').candidate;
}

export function resolveMemoryCandidate(
  id: string,
  resolution: MemoryCandidateResolution,
): MemoryCandidateInfo {
  return applyMemoryCandidateResolution(id, resolution).candidate;
}

export function listPendingMemoryCandidates(limit = 100): MemoryCandidateInfo[] {
  return listMemoryCandidates('pending', limit);
}

export function normalizeMemoryCandidateStatus(value: unknown): MemoryCandidateStatus {
  if (value === 'confirmed' || value === 'rejected') return value;
  return 'pending';
}
