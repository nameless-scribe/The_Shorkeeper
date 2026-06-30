import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { closeDatabase, initDatabase } from '../../db';
import { getSetting } from '../../db/app-settings';
import { createSession } from '../../db/repositories/sessions';
import { insertMessage } from '../../db/repositories/messages';
import {
  ACTIVE_SESSION_KEY,
  clearActiveSessionForTests,
  getActiveSession,
  getActiveSessionId,
  resetActiveSession,
  restoreActiveSession,
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
    expect(getSetting(ACTIVE_SESSION_KEY)).toBe(second.id);
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
    expect(getSetting(ACTIVE_SESSION_KEY)).toBe(first.id);
    expect(second.id).not.toBe(first.id);
  });

  it('restoreActiveSession reuses persisted session after restart', () => {
    const session = resetActiveSession();
    insertMessage(session.id, 'user', 'hello');

    clearActiveSessionForTests();

    const restored = restoreActiveSession();
    expect(restored.id).toBe(session.id);
    expect(getActiveSessionId()).toBe(session.id);
  });

  it('restoreActiveSession picks most recent session when pointer missing', () => {
    const older = createSession(undefined, 'older');
    const newer = createSession(undefined, 'newer');

    clearActiveSessionForTests();

    const restored = restoreActiveSession();
    expect(restored.id).toBe(newer.id);
    expect(restored.id).not.toBe(older.id);
  });

  it('restoreActiveSession creates one session when database is empty', () => {
    const session = restoreActiveSession();
    expect(session.title).toBe('新对话');
    expect(getSetting(ACTIVE_SESSION_KEY)).toBe(session.id);
  });
});
