import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, initDatabase, type AppDatabase } from '../../index';
import {
  deleteProfileKey,
  getProfileValue,
  listProfileEntries,
  setProfileValue,
} from '../user-profile';

describe('user profile repository', () => {
  let dbPath: string;
  let db: AppDatabase;

  beforeEach(async () => {
    dbPath = path.join(os.tmpdir(), `user-profile-${Date.now()}-${Math.random()}.db`);
    db = await initDatabase(dbPath);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(dbPath, { force: true });
  });

  it('supports injected CRUD without using the global database implicitly', () => {
    setProfileValue(' nickname ', '调律者', db);

    expect(getProfileValue('nickname', db)).toBe('调律者');
    expect(listProfileEntries(db)).toEqual([
      expect.objectContaining({ key: 'nickname', value: '调律者' }),
    ]);
    expect(deleteProfileKey('nickname', db)).toBe(true);
    expect(deleteProfileKey('nickname', db)).toBe(false);
  });
});
