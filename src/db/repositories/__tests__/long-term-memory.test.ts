import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, initDatabase, type AppDatabase } from '../../index';
import {
  createMemory,
  getMemoryByKey,
  getMemoryWithEmbeddingByKey,
  listMemories,
  listMemoryEmbeddings,
  searchMemoryEntries,
  updateMemoryByKey,
  updateMemoryEmbeddingByKey,
} from '../long-term-memory';

describe('long-term memory repository', () => {
  let dbPath: string;
  let db: AppDatabase;

  beforeEach(async () => {
    dbPath = path.join(os.tmpdir(), `long-term-memory-${Date.now()}-${Math.random()}.db`);
    db = await initDatabase(dbPath);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(dbPath, { force: true });
  });

  it('supports injected create, read, search, update, and list operations', () => {
    const first = createMemory(
      {
        memoryKey: 'user.preference.drink',
        content: '用户喜欢拿铁',
        importance: 0.8,
        sourceSessionId: 'session-1',
        createdAt: 100,
      },
      db,
    );
    createMemory(
      {
        content: '这是包含 100% 字面量的记忆',
        importance: 0.4,
        createdAt: 200,
      },
      db,
    );

    expect(getMemoryByKey('user.preference.drink', db)).toEqual(first);
    expect(searchMemoryEntries('拿铁', 5, db)).toEqual([first]);
    expect(searchMemoryEntries('%', 5, db)).toHaveLength(1);
    expect(listMemories(10, db)).toHaveLength(2);

    const updated = updateMemoryByKey(
      'user.preference.drink',
      {
        content: '用户喜欢冰拿铁',
        importance: 0.9,
        sourceSessionId: 'session-2',
        createdAt: 300,
        embedding: null,
      },
      db,
    );

    expect(updated).toEqual(
      expect.objectContaining({
        id: first.id,
        content: '用户喜欢冰拿铁',
        sourceSessionId: 'session-2',
      }),
    );
    expect(updateMemoryByKey('missing', {
      content: '不存在',
      importance: 0.5,
      embedding: null,
    }, db)).toBeUndefined();
  });

  it('normalizes and updates embedding blobs', () => {
    createMemory(
      {
        memoryKey: 'user.nickname',
        content: '用户名叫汐',
        importance: 0.8,
        embedding: new Uint8Array([1, 2, 3, 4]),
      },
      db,
    );

    expect(getMemoryWithEmbeddingByKey('user.nickname', db)?.embedding).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );

    updateMemoryEmbeddingByKey('user.nickname', new Uint8Array([5, 6]), db);

    expect(listMemoryEmbeddings(10, db)[0].embedding).toEqual(new Uint8Array([5, 6]));
  });
});
