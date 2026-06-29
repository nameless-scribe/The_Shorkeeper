import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { closeDatabase, initDatabase } from '../../db';
import {
  clearActiveSessionForTests,
  getActiveSession,
  getActiveSessionId,
  resetActiveSession,
  switchActiveSession,
} from '../active';

let dbPath: string;

beforeEach(async () => {
  clearActiveSessionForTests();
  dbPath = path.join(os.tmpdir(), `sk-active-${Date.now()}.db`);
  await initDatabase(dbPath);
});

afterEach(async () => {
  closeDatabase();
  clearActiveSessionForTests();
  await fs.unlink(dbPath).catch(() => undefined);
});

describe('active session', () => {
  it('resetActiveSession creates a new session each time', () => {
    const first = resetActiveSession();
    const second = resetActiveSession();
    expect(first.id).not.toBe(second.id);
    expect(getActiveSessionId()).toBe(second.id);
  });

  it('getActiveSession returns the current active session', () => {
    const created = resetActiveSession();
    const active = getActiveSession();
    expect(active.id).toBe(created.id);
  });

  it('switchActiveSession changes active without creating new row', () => {
    const first = resetActiveSession();
    const second = resetActiveSession();
    const switched = switchActiveSession(first.id);
    expect(switched.id).toBe(first.id);
    expect(getActiveSession().id).toBe(first.id);
    expect(second.id).not.toBe(first.id);
  });
});
