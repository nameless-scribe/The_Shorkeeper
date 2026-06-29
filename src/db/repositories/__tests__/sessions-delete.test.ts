import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { closeDatabase, initDatabase } from '../..';
import { createSession, deleteSession, getSession } from '../sessions';
import { insertMessage } from '../messages';
import {
  clearActiveSessionForTests,
  getActiveSession,
  getActiveSessionId,
  resetActiveSession,
  switchActiveSession,
} from '../../../session/active';

let dbPath: string;

beforeEach(async () => {
  clearActiveSessionForTests();
  dbPath = path.join(os.tmpdir(), `sk-delete-${Date.now()}.db`);
  await initDatabase(dbPath);
});

afterEach(async () => {
  closeDatabase();
  clearActiveSessionForTests();
  await fs.unlink(dbPath).catch(() => undefined);
});

describe('delete active session', () => {
  it('resetActiveSession after delete restores valid active pointer', () => {
    const session = resetActiveSession();
    insertMessage(session.id, 'user', 'hello');
    expect(getActiveSessionId()).toBe(session.id);

    deleteSession(session.id);
    expect(getSession(session.id)).toBeNull();

    const replacement = resetActiveSession();
    expect(getActiveSession().id).toBe(replacement.id);
    expect(replacement.id).not.toBe(session.id);
  });

  it('switchActiveSession fails for deleted session', () => {
    const a = resetActiveSession();
    const b = createSession(undefined, 'other');
    switchActiveSession(b.id);
    deleteSession(b.id);
    expect(() => switchActiveSession(b.id)).toThrow('会话不存在');
    switchActiveSession(a.id);
    expect(getActiveSession().id).toBe(a.id);
  });
});
