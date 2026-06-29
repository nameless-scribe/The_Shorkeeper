import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, initDatabase, type AppDatabase } from '../../db';
import { seedShorekeeper } from '../../db/seed';
import { isDuplicateMemory } from '../dedupe';
import { saveMemory, searchMemories, upsertMemory } from '../long-term';
import { getProfileSummary, setProfileValue } from '../user-profile';
import {
  createWorldbookEntry,
  matchWorldbook,
  searchWorldbook,
} from '../worldbook';
import { buildSystemPrompt } from '../../agent/context-builder';

let dbPath: string;
let db: AppDatabase;

beforeEach(async () => {
  dbPath = path.join(os.tmpdir(), `sk-mem-test-${Date.now()}-${Math.random()}.db`);
  db = await initDatabase(dbPath);
  seedShorekeeper(db);
});

afterEach(async () => {
  closeDatabase();
  await fs.unlink(dbPath).catch(() => undefined);
});

describe('user profile', () => {
  it('formats profile summary for prompt', () => {
    setProfileValue('nickname', '调律者');
    const summary = getProfileSummary();
    expect(summary).toContain('【用户画像】');
    expect(summary).toContain('调律者');
  });
});

describe('long term memory', () => {
  it('saves and searches memories', () => {
    const entry = saveMemory('用户喜欢喝拿铁', 0.8, 'session-1');
    expect(entry).not.toBeNull();
    const hits = searchMemories('拿铁');
    expect(hits).toHaveLength(1);
    expect(hits[0].content).toContain('拿铁');
  });

  it('upserts by memory_key instead of duplicating', () => {
    upsertMemory('user.nickname', '用户名叫汐', 0.8, 'session-1');
    upsertMemory('user.nickname', '用户名叫汐汐', 0.9, 'session-1');

    const hits = searchMemories('汐');
    expect(hits).toHaveLength(1);
    expect(hits[0].memoryKey).toBe('user.nickname');
    expect(hits[0].content).toBe('用户名叫汐汐');
  });
});

describe('worldbook', () => {
  it('matches entry when user message contains keyword', () => {
    createWorldbookEntry({
      keys: '魔法,法术',
      content: '魔法是源能的一种表现形式。',
      priority: 50,
    });

    const hits = matchWorldbook('我想学习魔法');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].content).toContain('源能');
  });

  it('searches worldbook by query', () => {
    createWorldbookEntry({
      keys: '测试关键词',
      content: '仅供检索测试的条目',
      priority: 1,
    });

    const hits = searchWorldbook('检索测试');
    expect(hits.some((h) => h.content.includes('检索测试'))).toBe(true);
  });
});

describe('dedupe', () => {
  it('detects exact and substring duplicates for legacy free-text', () => {
    expect(isDuplicateMemory('用户喜欢咖啡', ['喜欢咖啡'])).toBe(true);
    expect(isDuplicateMemory('完全不同的内容', ['喜欢咖啡'])).toBe(false);
  });
});

describe('saveMemory dedupe', () => {
  it('skips identical free-text writes', () => {
    const first = saveMemory('用户喜欢喝拿铁', 0.8, 'session-1');
    const second = saveMemory('用户喜欢喝拿铁', 0.8, 'session-1');
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(searchMemories('拿铁')).toHaveLength(1);
  });
});

describe('context builder', () => {
  it('includes worldbook hits in system prompt', () => {
    createWorldbookEntry({
      keys: '守岸人',
      content: '守岸人是黑海岸的守望者。',
      priority: 99,
    });

    const prompt = buildSystemPrompt({
      userMessage: '介绍一下守岸人',
      sessionId: 's1',
    });

    expect(prompt).toContain('守岸人是黑海岸的守望者');
    expect(prompt).toContain('【世界观 / 背景】');
  });
});
