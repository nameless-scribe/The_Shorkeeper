import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, initDatabase, type AppDatabase } from '../../db';
import {
  createMemory,
  getMemoryById,
  getMemoryByKey,
  listMemoryHistory,
  listMemories,
  searchMemoryEntries,
} from '../../db/repositories/long-term-memory';
import {
  createMemoryCandidate,
  getMemoryCandidate,
  hasRejectedMemoryFact,
} from '../../db/repositories/memory-candidates';
import { listMemorySources } from '../../db/repositories/memory-sources';
import { listGoals } from '../../db/repositories/goals';
import {
  rejectMemoryByUser,
  replaceMemoryFromUserEdit,
  resolveMemoryCandidate,
  stageMemoryConflict,
} from '../personal-memory-service';

describe('P1.2 personal memory versioning service', () => {
  let dbPath: string;
  let db: AppDatabase;

  beforeEach(async () => {
    dbPath = path.join(os.tmpdir(), `p1-memory-service-${Date.now()}-${Math.random()}.db`);
    db = await initDatabase(dbPath);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(dbPath, { force: true });
  });

  function createPreference(content = '用户喜欢拿铁') {
    return createMemory({
      memoryKey: 'user.preference.drink',
      content,
      importance: 0.9,
      memoryType: 'preference',
      confidence: 0.9,
      createdAt: 100,
    }, db);
  }

  function stageDrinkConflict(oldId: string) {
    return stageMemoryConflict({
      memoryKey: 'user.preference.drink',
      content: '用户现在改喝茶',
      category: 'stable_preference',
      confidence: 0.98,
      reason: '用户明确纠正',
      sourceSessionId: 'session-1',
      sourceMessageId: 'message-1',
      memoryType: 'preference',
      sensitivity: 'normal',
      modelUsePolicy: 'allow',
      conflictsWithMemoryId: oldId,
      proposedAction: 'replace',
    }, db)!;
  }

  it('atomically replaces a disputed fact, links history, records source, and is idempotent', () => {
    const old = createPreference();
    const candidate = stageDrinkConflict(old.id);
    expect(getMemoryById(old.id, db)?.status).toBe('disputed');
    expect(listMemories(10, db)).toEqual([]);

    const first = resolveMemoryCandidate(candidate.id, 'replace', db);
    const current = getMemoryByKey('user.preference.drink', db)!;
    const oldAfter = getMemoryById(old.id, db)!;
    expect(first.candidate.status).toBe('confirmed');
    expect(current.content).toBe('用户现在改喝茶');
    expect(oldAfter).toMatchObject({ status: 'superseded', supersededBy: current.id });
    expect(listMemoryHistory('user.preference.drink', db)).toHaveLength(2);
    expect(listMemorySources(current.id, db)).toEqual([
      expect.objectContaining({
        sourceType: 'conversation',
        sourceSessionId: 'session-1',
        sourceMessageId: 'message-1',
      }),
    ]);

    const repeated = resolveMemoryCandidate(candidate.id, 'replace', db);
    expect(repeated.candidate.status).toBe('confirmed');
    expect(listMemoryHistory('user.preference.drink', db)).toHaveLength(2);
  });

  it('restores the original when the user keeps it', () => {
    const old = createPreference();
    const candidate = stageDrinkConflict(old.id);
    const result = resolveMemoryCandidate(candidate.id, 'keep_original', db);
    expect(result.candidate.status).toBe('rejected');
    expect(getMemoryById(old.id, db)?.status).toBe('active');
    expect(getMemoryByKey('user.preference.drink', db)?.id).toBe(old.id);
  });

  it('keeps both facts under distinct active keys', () => {
    const old = createPreference();
    const candidate = stageDrinkConflict(old.id);
    resolveMemoryCandidate(candidate.id, 'coexist', db);
    const active = db.prepare(
      `SELECT id, memory_key FROM long_term_memory WHERE status = 'active' ORDER BY created_at`,
    ).all();
    expect(active).toHaveLength(2);
    expect(active.map((row) => row.memory_key)).toContain('user.preference.drink');
    expect(active.some((row) => String(row.memory_key).startsWith('user.preference.drink.context_')))
      .toBe(true);
  });

  it('versions user edits and keeps a user-edit source', () => {
    const old = createPreference();
    const replacement = replaceMemoryFromUserEdit(old, '用户喜欢美式', db);
    expect(replacement.id).not.toBe(old.id);
    expect(getMemoryById(old.id, db)).toMatchObject({
      status: 'superseded',
      supersededBy: replacement.id,
    });
    expect(listMemorySources(replacement.id, db)).toEqual([
      expect.objectContaining({ sourceType: 'user_edit', sourceRef: `memory-edit:${old.id}` }),
    ]);
    expect(hasRejectedMemoryFact('user.preference.drink', old.content, db)).toBe(true);
  });

  it('soft-rejects a deleted memory while preserving its audit row', () => {
    const old = createPreference();
    rejectMemoryByUser(old.id, db);
    expect(getMemoryByKey('user.preference.drink', db)).toBeUndefined();
    expect(getMemoryById(old.id, db)?.status).toBe('rejected');
    expect(hasRejectedMemoryFact('user.preference.drink', old.content, db)).toBe(true);
  });

  it('routes confirmed goal candidates to the goals truth source', () => {
    const candidate = createMemoryCandidate({
      memoryKey: 'user.goal.launch',
      content: '年底前完成产品发布',
      category: 'other',
      confidence: 0.95,
      reason: '用户明确目标',
      memoryType: 'goal',
      expiresAt: Date.parse('2026-12-31T00:00:00Z'),
    }, db)!;
    resolveMemoryCandidate(candidate.id, 'replace', db);
    expect(getMemoryCandidate(candidate.id, db)?.status).toBe('confirmed');
    expect(listGoals({ includeClosed: true }, db)).toEqual([
      expect.objectContaining({ title: '年底前完成产品发布', targetDate: '2026-12-31' }),
    ]);
    expect(getMemoryByKey('user.goal.launch', db)).toBeUndefined();
  });

  it('filters denied and expired facts from text and semantic retrieval inputs', () => {
    createMemory({
      memoryKey: 'user.procedure.health',
      content: '用户正在接受长期治疗',
      importance: 1,
      memoryType: 'procedure',
      sensitivity: 'sensitive',
      modelUsePolicy: 'deny',
    }, db);
    createMemory({
      memoryKey: 'user.event.old_trip',
      content: '用户上个月去了杭州',
      importance: 1,
      memoryType: 'event',
      expiresAt: Date.now() - 1,
    }, db);
    expect(listMemories(10, db)).toEqual([]);
    expect(searchMemoryEntries('用户', 10, db)).toEqual([]);
  });
});
