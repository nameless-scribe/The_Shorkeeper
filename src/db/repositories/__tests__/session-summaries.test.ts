import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, initDatabase, type AppDatabase } from '../../index';
import { createSession } from '../sessions';
import { getSessionSummary, upsertSessionSummary } from '../session-summaries';

describe('session summaries repository', () => {
  let dbPath: string;
  let db: AppDatabase;

  beforeEach(async () => {
    dbPath = path.join(os.tmpdir(), `session-summary-${Date.now()}-${Math.random()}.db`);
    db = await initDatabase(dbPath);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(dbPath, { force: true });
  });

  it('upserts the summary and marks the session compressed atomically', () => {
    const session = createSession(db);

    const summary = upsertSessionSummary(session.id, '摘要内容', 'message-1', db);

    expect(getSessionSummary(session.id, db)).toEqual(summary);
    const row = db.prepare('SELECT compressed FROM sessions WHERE id = ?').get(session.id);
    expect(row?.compressed).toBe(1);
  });
});
