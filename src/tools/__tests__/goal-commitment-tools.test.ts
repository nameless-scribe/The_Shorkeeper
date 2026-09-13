import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, initDatabase } from '../../db';
import { getUserTask, listUserTasks } from '../../db/user-tasks';
import { getScheduledTask } from '../../db/scheduled-tasks';
import { getCommitment, listCommitments } from '../../db/repositories/commitments';
import { listGoals } from '../../db/repositories/goals';
import { manageGoalsTool } from '../tasks/goal-tools';
import { manageCommitmentsTool } from '../tasks/commitment-tools';
import { updateUserTaskTool } from '../tasks/user-task-tools';
import { createScheduledTaskTool, deleteScheduledTaskTool } from '../schedule/schedule-tools';
import { resolveCallContract, shouldSuppressDuplicateCall } from '../contract';

let root = '';
const ctx = (runId = 'run-test') => ({
  sessionId: 'session-test',
  workspaceRoot: root,
  signal: new AbortController().signal,
  runId,
});

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-goal-tools-'));
  await initDatabase(path.join(root, 'goals.db'));
});

afterEach(async () => {
  closeDatabase();
  await fs.rm(root, { recursive: true, force: true });
});

function metadata<T>(result: { metadata?: Record<string, unknown> }, key: string): T {
  return result.metadata?.[key] as T;
}

describe('manage_goals', () => {
  it('creates, lists with progress, updates and closes a goal', async () => {
    const created = await manageGoalsTool.execute(
      { action: 'create', title: '学完 Rust 基础', priority: 2, target_date: '2026-12-31' },
      ctx(),
    );
    expect(created.success).toBe(true);
    const goalId = metadata<string>(created, 'goalId');

    const listed = await manageGoalsTool.execute({ action: 'list' }, ctx());
    expect(listed.output).toContain('学完 Rust 基础');
    expect(listed.output).toContain('待办 0/0');

    expect((await manageGoalsTool.execute({ action: 'update', id: goalId, status: 'done' }, ctx())).error)
      .toContain('close');
    expect((await manageGoalsTool.execute({ action: 'create', title: 'x', target_date: '明年' }, ctx())).error)
      .toContain('YYYY-MM-DD');

    const paused = await manageGoalsTool.execute({ action: 'update', id: goalId, status: 'paused' }, ctx());
    expect(paused.output).toContain('[paused]');
    const closed = await manageGoalsTool.execute({ action: 'close', id: goalId, status: 'dropped' }, ctx());
    expect(closed.success).toBe(true);
    expect(listGoals({}).length).toBe(0);
    expect((await manageGoalsTool.execute({ action: 'close', id: 'nope', status: 'done' }, ctx())).error)
      .toContain('未找到目标');
  });

  it('marks list as read-only and create as non-idempotent per call', () => {
    expect(shouldSuppressDuplicateCall(resolveCallContract(manageGoalsTool, { action: 'list' }))).toBe(false);
    expect(shouldSuppressDuplicateCall(resolveCallContract(manageGoalsTool, { action: 'create', title: 'x' }))).toBe(true);
    expect(shouldSuppressDuplicateCall(resolveCallContract(manageGoalsTool, { action: 'close', id: 'x' }))).toBe(false);
  });
});

describe('manage_commitments', () => {
  it('records a user commitment with an auto-created task and completes both together', async () => {
    const goal = await manageGoalsTool.execute({ action: 'create', title: '项目上线' }, ctx());
    const goalId = metadata<string>(goal, 'goalId');

    const recorded = await manageCommitmentsTool.execute(
      { action: 'record', title: '周五前交报告', due_at: '2026-09-18', promised_to: '老板', goal_id: goalId },
      ctx('run-record'),
    );
    expect(recorded.success).toBe(true);
    expect(recorded.output).toContain('并创建了对应待办');
    const commitmentId = metadata<string>(recorded, 'commitmentId');
    const taskId = metadata<string>(recorded, 'taskId');
    expect(getUserTask(taskId)).toMatchObject({ title: '周五前交报告', dueAt: '2026-09-18', goalId });
    expect(getCommitment(commitmentId)).toMatchObject({ sourceRunId: 'run-record', sourceSessionId: 'session-test' });

    const listed = await manageCommitmentsTool.execute({ action: 'list', due_within_days: 30 }, ctx());
    expect(listed.output).toContain('周五前交报告');
    expect(listed.output).toContain('答应了: 老板');

    // Finishing the todo through the normal tool closes the commitment with run evidence.
    const done = await updateUserTaskTool.execute({ id: taskId, status: 'done' }, ctx('run-done'));
    expect(done.success).toBe(true);
    expect(done.output).toContain('关联承诺已同步为 done');
    expect(getCommitment(commitmentId)).toMatchObject({ status: 'done', evidenceRunId: 'run-done' });

    // Reopening the todo reopens the commitment; completing the commitment closes the todo.
    await updateUserTaskTool.execute({ id: taskId, status: 'pending' }, ctx());
    expect(getCommitment(commitmentId)?.status).toBe('open');
    const completed = await manageCommitmentsTool.execute({ action: 'complete', id: commitmentId }, ctx('run-complete'));
    expect(completed.success).toBe(true);
    expect(getUserTask(taskId)?.status).toBe('done');
    expect(getCommitment(commitmentId)?.evidenceRunId).toBe('run-complete');
  });

  it('validates input and links to an existing task when asked', async () => {
    expect((await manageCommitmentsTool.execute({ action: 'record' }, ctx())).error).toContain('title');
    expect((await manageCommitmentsTool.execute({ action: 'record', title: 'x', due_at: '下周' }, ctx())).error)
      .toContain('due_at');
    expect((await manageCommitmentsTool.execute({ action: 'record', title: 'x', goal_id: 'ghost' }, ctx())).error)
      .toContain('未找到目标');
    expect((await manageCommitmentsTool.execute({ action: 'record', title: 'x', task_id: 'ghost' }, ctx())).error)
      .toContain('未找到待办');
    expect(listCommitments({})).toEqual([]);
    expect(listUserTasks()).toEqual([]);

    const recorded = await manageCommitmentsTool.execute(
      { action: 'record', title: '交房租', due_at: '2026-09-20T18:00:00' },
      ctx(),
    );
    const taskId = metadata<string>(recorded, 'taskId');
    const linked = await manageCommitmentsTool.execute(
      { action: 'record', title: '同一件事的另一个承诺', task_id: taskId },
      ctx(),
    );
    expect(linked.success).toBe(true);
    expect(linked.output).not.toContain('并创建了对应待办');
    expect(listUserTasks()).toHaveLength(1);
    expect(getUserTask(taskId)?.dueAt).toBe('2026-09-20');

    const cancelled = await manageCommitmentsTool.execute(
      { action: 'cancel', id: metadata<string>(linked, 'commitmentId') },
      ctx(),
    );
    expect(cancelled.output).toContain('关联待办保留');
    expect(getUserTask(taskId)?.status).toBe('pending');
  });
});

describe('assistant commitments from reminders', () => {
  it('records a commitment when a reminder is created and cancels it when the reminder is deleted', async () => {
    const created = await createScheduledTaskTool.execute(
      {
        name: '交房租',
        schedule_kind: 'once',
        run_at: '2099-01-05T09:00:00',
        message: '别忘了交房租',
      },
      ctx('run-reminder'),
    );
    expect(created.success).toBe(true);
    const taskId = metadata<string>(created, 'taskId');
    expect(getScheduledTask(taskId)).not.toBeNull();

    const [commitment] = listCommitments({ owner: 'assistant' });
    expect(commitment).toMatchObject({
      title: '提醒：交房租',
      status: 'open',
      scheduledTaskId: taskId,
      sourceRunId: 'run-reminder',
    });
    expect(commitment.dueAt).toBe(Date.parse('2099-01-05T09:00:00'));

    const deleted = await deleteScheduledTaskTool.execute({ id: taskId }, ctx());
    expect(deleted.success).toBe(true);
    expect(getCommitment(commitment.id)?.status).toBe('cancelled');
  });
});
