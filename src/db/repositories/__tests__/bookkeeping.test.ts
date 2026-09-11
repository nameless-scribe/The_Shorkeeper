import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, initDatabase, type AppDatabase } from '../../index';
import { createBookkeepingEntry, listBookkeepingEntries } from '../bookkeeping';

describe('bookkeeping repository', () => {
  let dbPath: string;
  let db: AppDatabase;

  beforeEach(async () => {
    dbPath = path.join(os.tmpdir(), `bookkeeping-${Date.now()}-${Math.random()}.db`);
    db = await initDatabase(dbPath);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(dbPath, { force: true });
  });

  it('creates and maps bookkeeping entries', () => {
    const created = createBookkeepingEntry(
      {
        sessionId: 'session-1',
        category: ' 餐饮 ',
        amount: 28.5,
        note: ' 午餐 ',
        entryType: 'expense',
      },
      db,
    );

    expect(listBookkeepingEntries(10, db)).toEqual([created]);
    expect(created).toMatchObject({
      sessionId: 'session-1',
      category: '餐饮',
      note: '午餐',
      entryType: 'expense',
      currency: 'CNY',
    });
  });
});
