import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, initDatabase, type AppDatabase } from '../../index';
import {
  createWorldbookEntry,
  deleteWorldbookEntry,
  getWorldbookEntry,
  hasWorldbookFts,
  listWorldbookEntries,
  searchWorldbookEntries,
  searchWorldbookFtsIds,
  updateWorldbookEntry,
} from '../worldbook';

describe('worldbook repository', () => {
  let dbPath: string;
  let db: AppDatabase;

  beforeEach(async () => {
    dbPath = path.join(os.tmpdir(), `worldbook-repository-${Date.now()}-${Math.random()}.db`);
    db = await initDatabase(dbPath);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(dbPath, { force: true });
  });

  it('supports injected CRUD and enabled filtering', () => {
    const enabled = createWorldbookEntry(
      {
        keys: ' 守岸人,黑海岸 ',
        content: ' 守岸人的背景设定 ',
        priority: 10,
        createdAt: 100,
      },
      db,
    );
    const disabled = createWorldbookEntry(
      {
        keys: '隐藏设定',
        content: '不应参与匹配',
        enabled: false,
        createdAt: 200,
      },
      db,
    );

    expect(enabled.keys).toBe('守岸人,黑海岸');
    expect(getWorldbookEntry(enabled.id, db)).toEqual(enabled);
    expect(listWorldbookEntries(true, db)).toHaveLength(2);
    expect(listWorldbookEntries(false, db)).toEqual([enabled]);

    const updated = updateWorldbookEntry(
      enabled.id,
      { content: '更新后的背景设定', priority: 20, enabled: false },
      db,
    );
    expect(updated).toEqual(expect.objectContaining({ content: '更新后的背景设定', priority: 20, enabled: false }));
    expect(updateWorldbookEntry('missing', { content: '不存在' }, db)).toBeUndefined();
    expect(deleteWorldbookEntry(disabled.id, db)).toBe(true);
    expect(deleteWorldbookEntry(disabled.id, db)).toBe(false);
  });

  it('searches literal LIKE patterns and reports optional FTS capability', () => {
    const entry = createWorldbookEntry(
      {
        keys: '100%规则',
        content: '包含下划线 _ 的设定',
        priority: 1,
      },
      db,
    );

    expect(searchWorldbookEntries('%', 5, db)).toEqual([entry]);
    expect(searchWorldbookEntries('_', 5, db)).toEqual([entry]);
    expect(hasWorldbookFts(db)).toBe(false);
    expect(searchWorldbookFtsIds(['设定'], db)).toBeNull();
  });
});
