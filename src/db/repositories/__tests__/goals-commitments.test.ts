import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type AppDatabase } from '../../index';
import { openNativeDatabase } from '../../native-adapter';
import { createUserTask, getUserTask, listUserTasks, updateUserTask } from '../../user-tasks';
import { closeGoal, createGoal, getGoalProgress, listGoals, updateGoal } from '../goals';
import {
  cancelCommitmentForScheduledTask,
  completeCommitment,
  completeCommitmentForScheduledTask,
  confirmProposedCommitment,
  createCommitment,
  createUserCommitmentWithTask,
  findCommitmentByTask,
  getCommitment,
  listCommitments,
  markMissedCommitments,
  setCommitmentStatus,
  syncCommitmentWithTaskStatus,
} from '../commitments';
import { claimBriefing, getBriefing, listBriefings, updateBriefing } from '../briefings';

interface ContractDatabase extends AppDatabase {
  close(): void;
}

const adapters = [
  { name: 'sql.js', open: (dbPath: string) => openDatabase(dbPath) },
  { name: 'better-sqlite3', open: async (dbPath: string) => openNativeDatabase(dbPath) },
] as const;

for (const adapter of adapters) {
  describe(`goals, commitments and briefings (${adapter.name})`, () => {
    let tempDir: string;
    let db: ContractDatabase | undefined;

    afterEach(() => {
      db?.close();
      db = undefined;
      if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    });

    async function open(): Promise<ContractDatabase> {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `shorekeeper-goals-${adapter.name}-`));
      db = await adapter.open(path.join(tempDir, 'goals.db'));
      return db;
    }

    it('tracks goals with task progress and refuses to reopen closed goals', async () => {
      const database = await open();
      const goal = createGoal({ title: '  完成季度报告 ', priority: 9, targetDate: '2026-09-30' }, database);
      expect(goal).toMatchObject({ title: '完成季度报告', status: 'active', priority: 3 });

      const task = createUserTask({ title: '整理数据', goalId: goal.id }, database);
      createUserTask({ title: '写初稿', goalId: goal.id }, database);
      createUserTask({ title: '已取消', goalId: goal.id, status: 'cancelled' }, database);
      updateUserTask(task.id, { status: 'done' }, database);
      expect(getGoalProgress(goal.id, database)).toEqual({ totalTasks: 2, doneTasks: 1, openCommitments: 0 });
      expect(listUserTasks({ goalId: goal.id, statuses: ['pending', 'in_progress'] }, database)).toHaveLength(1);

      expect(updateGoal(goal.id, { status: 'paused', description: ' 等数据 ' }, database)).toMatchObject({
        status: 'paused',
        description: '等数据',
      });
      expect(listGoals({}, database).map((item) => item.id)).toEqual([goal.id]);
      const closed = closeGoal(goal.id, 'done', database);
      expect(closed?.closedAt).not.toBeNull();
      expect(listGoals({}, database)).toEqual([]);
      expect(listGoals({ includeClosed: true }, database)).toHaveLength(1);
      expect(() => updateGoal(goal.id, { status: 'active' }, database)).toThrow('已关闭的目标');
    });

    it('creates a user commitment together with its task in one transaction', async () => {
      const database = await open();
      const goal = createGoal({ title: '搬家' }, database);
      const { commitment, taskCreated } = createUserCommitmentWithTask(
        {
          title: '周五前把报告交给老板',
          dueAt: Date.parse('2026-09-18T23:59:59'),
          dueDate: '2026-09-18',
          promisedTo: '老板',
          goalId: goal.id,
          sourceSessionId: 's1',
          sourceRunId: 'run-1',
        },
        database,
      );
      expect(taskCreated).toBe(true);
      expect(commitment).toMatchObject({ owner: 'user', status: 'open', promisedTo: '老板', goalId: goal.id });
      const task = getUserTask(commitment.taskId!, database);
      expect(task).toMatchObject({ title: '周五前把报告交给老板', dueAt: '2026-09-18', goalId: goal.id });
      expect(getGoalProgress(goal.id, database).openCommitments).toBe(1);

      // Linking an unknown task rolls the whole thing back.
      expect(() =>
        createUserCommitmentWithTask({ title: 'x', taskId: 'missing' }, database),
      ).toThrow('未找到待办');
      expect(listCommitments({}, database)).toHaveLength(1);

      // Task status drives the commitment, with run evidence on completion.
      expect(syncCommitmentWithTaskStatus(task!.id, 'done', 'run-9', database)).toMatchObject({
        status: 'done',
        evidenceRunId: 'run-9',
      });
      expect(getCommitment(commitment.id, database)?.closedAt).not.toBeNull();
      expect(syncCommitmentWithTaskStatus(task!.id, 'done', 'run-9', database)).toBeNull();
      expect(syncCommitmentWithTaskStatus(task!.id, 'pending', null, database)).toMatchObject({
        status: 'open',
        evidenceRunId: null,
        closedAt: null,
      });

      // Completing the commitment marks the task done as well.
      completeCommitment(commitment.id, { evidenceRunId: 'run-10' }, database);
      expect(getUserTask(task!.id, database)?.status).toBe('done');
      expect(findCommitmentByTask(task!.id, database)?.evidenceRunId).toBe('run-10');
    });

    it('confirms proposed commitments and marks overdue open ones as missed', async () => {
      const database = await open();
      const proposed = createCommitment(
        { title: '给妈妈回电话', owner: 'user', status: 'proposed', promisedTo: '妈妈' },
        database,
      );
      expect(proposed.taskId).toBeNull();
      expect(listCommitments({ statuses: ['proposed', 'open'] }, database)).toHaveLength(1);

      const confirmed = confirmProposedCommitment(proposed.id, { dueDate: '2026-09-14' }, database);
      expect(confirmed?.status).toBe('open');
      expect(getUserTask(confirmed!.taskId!, database)).toMatchObject({ title: '给妈妈回电话', dueAt: '2026-09-14' });
      expect(confirmProposedCommitment(proposed.id, {}, database)?.taskId).toBe(confirmed?.taskId);

      const overdue = createCommitment({ title: '过期', owner: 'user', dueAt: 1_000 }, database);
      const future = createCommitment({ title: '未来', owner: 'user', dueAt: 5_000 }, database);
      const noDue = createCommitment({ title: '无期限', owner: 'user' }, database);
      const missed = markMissedCommitments(2_000, database);
      expect(missed.map((item) => item.id)).toEqual([overdue.id]);
      expect(getCommitment(future.id, database)?.status).toBe('open');
      expect(getCommitment(noDue.id, database)?.status).toBe('open');
      expect(listCommitments({ dueBefore: 5_000, status: 'open' }, database).map((item) => item.id)).toEqual([future.id]);
      expect(setCommitmentStatus(overdue.id, 'open', {}, database)?.closedAt).toBeNull();
    });

    it('links assistant commitments to scheduled reminders', async () => {
      const database = await open();
      const once = createCommitment(
        { title: '提醒：交房租', owner: 'assistant', dueAt: 10, scheduledTaskId: 'task-once' },
        database,
      );
      const recurring = createCommitment(
        { title: '提醒：喝水', owner: 'assistant', scheduledTaskId: 'task-recurring' },
        database,
      );
      expect(completeCommitmentForScheduledTask('task-once', 'run-1', database)).toMatchObject({
        status: 'done',
        evidenceRunId: 'run-1',
      });
      expect(completeCommitmentForScheduledTask('task-once', 'run-2', database)).toBeNull();
      expect(cancelCommitmentForScheduledTask('task-recurring', database)?.status).toBe('cancelled');
      expect(cancelCommitmentForScheduledTask('task-recurring', database)).toBeNull();
      expect(cancelCommitmentForScheduledTask('unknown', database)).toBeNull();
      expect(getCommitment(once.id, database)?.status).toBe('done');
      expect(getCommitment(recurring.id, database)?.status).toBe('cancelled');
    });

    it('allows one briefing per day and kind', async () => {
      const database = await open();
      const first = claimBriefing({ briefDate: '2026-09-13', kind: 'morning', runId: 'run-a' }, database);
      expect(first.created).toBe(true);
      const again = claimBriefing({ briefDate: '2026-09-13', kind: 'morning', runId: 'run-b' }, database);
      expect(again.created).toBe(false);
      expect(again.briefing.id).toBe(first.briefing.id);
      expect(again.briefing.runId).toBe('run-a');
      expect(claimBriefing({ briefDate: '2026-09-13', kind: 'evening' }, database).created).toBe(true);

      updateBriefing(first.briefing.id, { status: 'delivered', summary: '三条待办' }, database);
      expect(getBriefing('2026-09-13', 'morning', database)).toMatchObject({ status: 'delivered', summary: '三条待办' });
      expect(listBriefings(10, database)).toHaveLength(2);
    });
  });
}
