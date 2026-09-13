import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, initDatabase, type AppDatabase } from '../../index';
import {
  createMemoryCandidate,
  getMemoryCandidate,
  hasRejectedMemoryFact,
  listMemoryCandidates,
  rejectMemoryFact,
  setMemoryCandidateStatus,
} from '../memory-candidates';

describe('memory candidate repository', () => {
  let dbPath: string;
  let db: AppDatabase;

  beforeEach(async () => {
    dbPath = path.join(os.tmpdir(), `memory-candidates-${Date.now()}-${Math.random()}.db`);
    db = await initDatabase(dbPath);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(dbPath, { force: true });
  });

  it('deduplicates pending and rejected candidates', () => {
    const input = {
      memoryKey: 'user.preference.drink',
      content: '用户喜欢拿铁',
      category: 'stable_preference' as const,
      confidence: 0.7,
      reason: '用户表达',
      sourceSessionId: 'session-1',
    };
    const first = createMemoryCandidate(input, db);
    expect(first?.status).toBe('pending');
    expect(createMemoryCandidate(input, db)).toBeNull();

    setMemoryCandidateStatus(first!.id, 'rejected', db);
    expect(createMemoryCandidate(input, db)).toBeNull();
    expect(getMemoryCandidate(first!.id, db)?.status).toBe('rejected');
    expect(listMemoryCandidates('pending', 10, db)).toHaveLength(0);
  });

  it('lists candidates by status and preserves metadata', () => {
    const candidate = createMemoryCandidate({
      memoryKey: 'user.relationship.trust',
      content: '用户重视稳定的陪伴',
      category: 'relationship',
      confidence: 0.91,
      reason: '用户明确表达',
      sourceSessionId: null,
      sourceMessageId: 'message-1',
      sourceRunId: 'run-1',
      memoryType: 'relationship',
      sensitivity: 'private',
      modelUsePolicy: 'allow',
      validFrom: 100,
      expiresAt: 200,
      conflictsWithMemoryId: 'memory-1',
      proposedAction: 'replace',
    }, db)!;

    expect(listMemoryCandidates('pending', 10, db)).toEqual([
      expect.objectContaining({
        id: candidate.id,
        category: 'relationship',
        confidence: 0.91,
        sourceSessionId: null,
        sourceMessageId: 'message-1',
        sourceRunId: 'run-1',
        memoryType: 'relationship',
        sensitivity: 'private',
        modelUsePolicy: 'allow',
        validFrom: 100,
        expiresAt: 200,
        conflictsWithMemoryId: 'memory-1',
        proposedAction: 'replace',
      }),
    ]);
    expect(setMemoryCandidateStatus(candidate.id, 'confirmed', db)?.status).toBe('confirmed');
    expect(listMemoryCandidates('confirmed', 10, db)).toHaveLength(1);
  });

  it('updates a pending candidate when the same key gets new content', () => {
    const first = createMemoryCandidate({
      memoryKey: 'user.nickname',
      content: '用户叫汐',
      category: 'stable_preference',
      confidence: 0.7,
      reason: '第一次自称',
      sourceSessionId: 'session-1',
    }, db)!;
    const updated = createMemoryCandidate({
      memoryKey: 'user.nickname',
      content: '用户叫小汐',
      category: 'stable_preference',
      confidence: 0.9,
      reason: '更正称呼',
      sourceSessionId: 'session-2',
    }, db);

    expect(updated).toMatchObject({
      id: first.id,
      content: '用户叫小汐',
      confidence: 0.9,
      reason: '更正称呼',
      sourceSessionId: 'session-2',
      status: 'pending',
    });
    expect(listMemoryCandidates('pending', 10, db)).toHaveLength(1);
  });

  it('records a deleted memory fact so it is not auto-restored', () => {
    const rejected = rejectMemoryFact({
      memoryKey: 'user.preference.drink',
      content: '用户喜欢拿铁',
      category: 'stable_preference',
      confidence: 1,
      reason: '用户从设置中删除',
    }, db);

    expect(rejected.status).toBe('rejected');
    expect(hasRejectedMemoryFact('user.preference.drink', '用户喜欢拿铁', db)).toBe(true);
    expect(createMemoryCandidate({
      memoryKey: 'user.preference.drink',
      content: '用户喜欢拿铁',
      category: 'stable_preference',
      confidence: 0.95,
      reason: '再次提取',
    }, db)).toBeNull();
  });
});
