import { describe, expect, it } from 'vitest';
import type { MemoryCandidateInfo, MemoryInfo } from '@/shared/types';
import { formatCandidateMeta, MEMORY_TYPE_LABELS } from '../MemoryCandidatesPanel';
import { replaceVersionedMemory } from '../LongTermMemoryPanel';

describe('memory candidate panel presentation', () => {
  it('covers every personal memory type with product-consistent labels', () => {
    expect(Object.keys(MEMORY_TYPE_LABELS)).toEqual([
      'identity', 'preference', 'relationship', 'event',
      'goal', 'habit', 'procedure', 'other',
    ]);
  });

  it('replaces the old row when a versioned edit returns a new id', () => {
    const old = {
      id: 'old',
      content: '旧事实',
    } as MemoryInfo;
    const replacement = {
      id: 'new',
      content: '新事实',
    } as MemoryInfo;
    expect(replaceVersionedMemory([old], 'old', replacement)).toEqual([replacement]);
  });

  it('shows confidence, source and expiry metadata', () => {
    const candidate: MemoryCandidateInfo = {
      id: 'candidate-1',
      memoryKey: 'user.event.trip',
      content: '用户下周去杭州',
      category: 'other',
      confidence: 0.91,
      reason: '明确行程',
      sourceSessionId: 'session-12345678',
      sourceMessageId: 'message-1',
      sourceRunId: null,
      memoryType: 'event',
      sensitivity: 'private',
      modelUsePolicy: 'allow',
      validFrom: null,
      expiresAt: Date.parse('2026-09-20T00:00:00Z'),
      conflictsWithMemoryId: null,
      proposedAction: 'create',
      status: 'pending',
      createdAt: Date.parse('2026-09-13T00:00:00Z'),
      updatedAt: Date.parse('2026-09-13T00:00:00Z'),
    };
    const meta = formatCandidateMeta(candidate);
    expect(meta).toContain('91% 置信度');
    expect(meta).toContain('私密');
    expect(meta).toContain('来源会话 session-1234');
    expect(meta).toContain('有效至');
  });

  it('makes model-denied sensitive candidates explicit', () => {
    const candidate = {
      confidence: 0.86,
      sourceSessionId: null,
      createdAt: Date.parse('2026-09-13T00:00:00Z'),
      expiresAt: null,
      sensitivity: 'sensitive',
      modelUsePolicy: 'deny',
    } as MemoryCandidateInfo;
    expect(formatCandidateMeta(candidate)).toContain('敏感 · 不提供给模型');
  });
});
