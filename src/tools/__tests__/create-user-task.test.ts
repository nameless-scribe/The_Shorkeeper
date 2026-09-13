import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, initDatabase } from '../../db';
import { listUserTasks } from '../../db/user-tasks';
import { createUserTaskTool } from '../tasks/user-task-tools';

let root = '';
const ctx = () => ({ sessionId: 's1', workspaceRoot: root, signal: new AbortController().signal });

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-create-task-'));
  await initDatabase(path.join(root, 'tasks.db'));
});

afterEach(async () => {
  closeDatabase();
  await fs.rm(root, { recursive: true, force: true });
});

describe('create_user_task', () => {
  it('creates a pending todo directly from the agent without an Excel source', async () => {
    const result = await createUserTaskTool.execute(
      { title: '  给房东回消息 ', due_at: '2026-09-15', module: '生活', notes: '关于续租' },
      ctx(),
    );

    expect(result.success).toBe(true);
    const [task] = listUserTasks();
    expect(task).toMatchObject({
      title: '给房东回消息',
      status: 'pending',
      dueAt: '2026-09-15',
      module: '生活',
      notes: '关于续租',
      sourceFile: null,
      sourceRow: null,
    });
    expect(result.metadata).toEqual({ taskId: task.id });
    expect(result.output).toContain(task.id);
  });

  it('rejects invalid input before touching the database', async () => {
    expect((await createUserTaskTool.execute({}, ctx())).error).toContain('title');
    expect((await createUserTaskTool.execute({ title: 'x', due_at: '下周' }, ctx())).error).toContain('YYYY-MM-DD');
    expect((await createUserTaskTool.execute({ title: 'x', due_at: '2026-02-30' }, ctx())).error).toContain('YYYY-MM-DD');
    expect((await createUserTaskTool.execute({ title: 'x', status: 'done' }, ctx())).error).toContain('pending 或 in_progress');
    expect((await createUserTaskTool.execute({ title: 'x'.repeat(501) }, ctx())).error).toContain('上限');
    expect(listUserTasks()).toEqual([]);
  });

  it('declares itself as a non-idempotent local append', () => {
    expect(createUserTaskTool.requiresPermission).toEqual([]);
    expect(createUserTaskTool.sideEffects).toMatchObject({ risk: 'low', idempotent: false, evidence: 'output' });
  });
});
