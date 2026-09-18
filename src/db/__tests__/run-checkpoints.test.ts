import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, type AppDatabase } from '../index';
import { openNativeDatabase } from '../native-adapter';
import { createSession, deleteSession } from '../repositories/sessions';
import { createTaskRun, updateTaskRunPhase, finishTaskRun } from '../repositories/task-runs';
import { saveRunCheckpoint, readRunCheckpoint, claimRunCheckpoint, getRunCheckpointInfo } from '../repositories/run-checkpoints';
import type { RunCheckpoint } from '../../agent/checkpoint-contract';
import { protectSecret } from '../../security/secret-storage';
import { rehearseNativeMigration } from '../native-migration';
import { validateDatabaseFile } from '../backup';

// 仅替换系统加密边界，所有 DB / migration / 事务运行在真实临时适配器上。
vi.mock('../../security/secret-storage', () => ({
  protectSecret: vi.fn((value: string) => `test-protected:${Buffer.from(value).toString('base64')}`),
  isProtectedSecret: (value: string) => value.startsWith('test-protected:'),
  revealSecret: (value: string) => Buffer.from(value.slice(15), 'base64').toString(),
}));

const snapshot: RunCheckpoint = { version: 1, rootRunId: 'parent', goal: 'test-private-goal', answers: ['确认金额口径'],
  facts: ['生成 CSV'], pending: ['导出 Excel'], completedEffects: ['a'.repeat(64)], files: [], environment: 'b'.repeat(64),
  totals: { rounds: 20, toolCalls: 30, tokens: 300000, activeMs: 40000, segments: 1 } };

for (const adapter of [
  { name: 'sql.js', open: openDatabase },
  { name: 'better-sqlite3', open: async (file: string) => openNativeDatabase(file, { allowExisting: true }) },
]) describe(`run checkpoints (${adapter.name})`, () => {
  let root: string;
  let db: AppDatabase & { close(): void };
  let sessionId: string;
  afterEach(() => { db?.close(); if (root) fs.rmSync(root, { recursive: true, force: true }); });
  async function open() {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-checkpoints-'));
    db = await adapter.open(path.join(root, 'test.db'));
    sessionId = createSession(db).id;
    createTaskRun({ id: 'parent', sessionId }, db);
    updateTaskRunPhase('parent', 'finalizing', db);
  }
  function save() {
    const id = saveRunCheckpoint('parent', sessionId, snapshot, db);
    finishTaskRun('parent', { phase: 'error', terminalReason: 'budget_exhausted' }, db);
    return id;
  }

  it('migrates, encrypts, roundtrips after reopening, and does not advertise an unfinished run', async () => {
    await open();
    const id = saveRunCheckpoint('parent', sessionId, snapshot, db);
    expect(getRunCheckpointInfo('parent', db)?.available).toBe(false);
    const stored = db.prepare('SELECT payload FROM task_run_checkpoints WHERE id = ?').get(id)!;
    expect(stored.payload).not.toContain('test-private-goal');
    finishTaskRun('parent', { phase: 'error', terminalReason: 'budget_exhausted' }, db);
    db.close();
    db = await adapter.open(path.join(root, 'test.db'));
    expect(readRunCheckpoint(id, sessionId, db)).toEqual(snapshot);
    expect(getRunCheckpointInfo('parent', db)).toMatchObject({ available: true, claimedRunId: null });
    expect(db.prepare("SELECT status FROM schema_migrations WHERE name = '0030_run_checkpoints.sql'").get()?.status).toBe('applied');
  });

  it('claims only once for a recorded child in the same session and leaves the parent terminal unchanged', async () => {
    await open(); const id = save();
    expect(() => readRunCheckpoint(id, 'different-session', db)).toThrow();
    expect(() => claimRunCheckpoint(id, sessionId, 'missing-child', db)).toThrow();
    expect(getRunCheckpointInfo('parent', db)?.available).toBe(true);
    createTaskRun({ id: 'child', sessionId }, db);
    claimRunCheckpoint(id, sessionId, 'child', db);
    expect(() => claimRunCheckpoint(id, sessionId, 'child', db)).toThrow();
    expect(getRunCheckpointInfo('parent', db)).toMatchObject({ available: false, claimedRunId: 'child' });
    expect(db.prepare('SELECT phase, terminal_reason FROM task_runs WHERE id = ?').get('parent'))
      .toEqual({ phase: 'error', terminal_reason: 'budget_exhausted' });
  });

  it('rejects expired checkpoints and deletes snapshots along with a session', async () => {
    await open(); const id = save();
    db.prepare('UPDATE task_run_checkpoints SET expires_at = 1 WHERE id = ?').run(id);
    expect(() => readRunCheckpoint(id, sessionId, db)).toThrow();
    deleteSession(sessionId, db);
    expect(db.prepare('SELECT id FROM task_run_checkpoints').all()).toEqual([]);
  });

  it('refuses an unbounded payload and leaves no misleading checkpoint row', async () => {
    await open();
    expect(() => saveRunCheckpoint('parent', sessionId, { ...snapshot, goal: 'x'.repeat(100001) }, db)).toThrow();
    expect(getRunCheckpointInfo('parent', db)).toBeNull();
  });

  it('fails closed if system encryption is unavailable', async () => {
    await open();
    vi.mocked(protectSecret).mockImplementationOnce((value) => value);
    expect(() => saveRunCheckpoint('parent', sessionId, snapshot, db)).toThrow('加密不可用');
    expect(getRunCheckpointInfo('parent', db)).toBeNull();
  });

  it('disables continuation at the chain limit before creating or claiming a child', async () => {
    await open();
    const id = saveRunCheckpoint('parent', sessionId, { ...snapshot, totals: { ...snapshot.totals, segments: 10 } }, db);
    finishTaskRun('parent', { phase: 'error', terminalReason: 'budget_exhausted' }, db);
    expect(getRunCheckpointInfo('parent', db)).toMatchObject({ available: false, unavailableReason: expect.stringContaining('10 段') });
    expect(() => readRunCheckpoint(id, sessionId, db)).toThrow('10 段');
  });

  if (adapter.name === 'sql.js') it('preserves encrypted checkpoints through native migration and rollback rehearsal', async () => {
    await open(); const id = save();
    db.close();
    const file = path.join(root, 'test.db');
    const before = await validateDatabaseFile(file);
    const report = await rehearseNativeMigration(file, { keepMigratedCopy: true, workingDirectory: root });
    expect(report.rollbackVerified).toBe(true);
    expect((await validateDatabaseFile(file)).sha256).toBe(before.sha256);
    db = openNativeDatabase(report.migratedCopyPath!, { allowExisting: true, initialize: false });
    expect(readRunCheckpoint(id, sessionId, db)).toEqual(snapshot);
  });
});
