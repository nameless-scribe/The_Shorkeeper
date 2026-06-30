import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { closeDatabase, initDatabase } from '../..';
import { createSession, deleteEmptySessions, listSessions } from '../sessions';
import { insertMessage } from '../messages';

let dbPath: string;

beforeEach(async () => {
  dbPath = path.join(os.tmpdir(), `sk-empty-${Date.now()}.db`);
  await initDatabase(dbPath);
});

afterEach(async () => {
  closeDatabase();
  await fs.unlink(dbPath).catch(() => undefined);
});

describe('deleteEmptySessions', () => {
  it('removes sessions with no messages but keeps specified session', () => {
    const keep = createSession(undefined, 'keep');
    const empty1 = createSession(undefined, 'empty1');
    const empty2 = createSession(undefined, 'empty2');
    const withMsg = createSession(undefined, 'with-msg');
    insertMessage(withMsg.id, 'user', 'hi');

    const result = deleteEmptySessions({ keepSessionId: keep.id });

    expect(result.deletedCount).toBe(2);
    expect(result.deletedIds).toContain(empty1.id);
    expect(result.deletedIds).toContain(empty2.id);
    expect(result.deletedIds).not.toContain(keep.id);
    expect(result.deletedIds).not.toContain(withMsg.id);
    expect(listSessions({ limit: 100 }).total).toBe(2);
  });
});
