import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, initDatabase } from '../../db';
import { createUserTask, updateUserTask } from '../../db/user-tasks';
import { createScheduledTask } from '../../db/scheduled-tasks';
import { setProfileValue } from '../../db/repositories/user-profile';
import { createGoal } from '../../db/repositories/goals';
import { createCommitment, getCommitment } from '../../db/repositories/commitments';
import { createTaskRun, finishTaskRun, recordRunArtifacts, startTaskRunStep } from '../../db/repositories/task-runs';
import { addLocalDays, formatLocalDate } from '../due-date';
import {
  buildEveningReviewData,
  buildMorningBriefData,
  formatEveningReview,
  formatMorningBrief,
  resolveWeatherCity,
} from '../daily-steward';

describe('daily steward data', () => {
  let tempDir: string;
  const today = formatLocalDate();
  const yesterday = addLocalDays(today, -1)!;
  const tomorrow = addLocalDays(today, 1)!;
  const nextWeek = addLocalDays(today, 7)!;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-steward-'));
    await initDatabase(path.join(tempDir, 'steward.db'));
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('collects the six morning sections from real tables', () => {
    setProfileValue('user.city', '大连');
    const goal = createGoal({ title: '季度报告', targetDate: nextWeek });
    createUserTask({ title: '昨天就该做', dueAt: yesterday, goalId: goal.id });
    createUserTask({ title: '今天要做', dueAt: today, goalId: goal.id });
    createUserTask({ title: '已完成', dueAt: today, status: 'done', goalId: goal.id });
    createUserTask({ title: '下周再说', dueAt: nextWeek });
    createUserTask({ title: '没有日期' });
    createScheduledTask({
      name: '交房租',
      scheduleKind: 'once',
      runAt: new Date().setHours(23, 30, 0, 0),
      actionType: 'reminder',
      actionPayload: '{}',
    });
    createScheduledTask({ name: '喝水', cron: '0 * * * *', actionType: 'reminder', actionPayload: '{}' });
    createCommitment({ title: '明天回复客户', owner: 'user', dueAt: Date.parse(`${tomorrow}T12:00:00`), promisedTo: '客户' });
    createCommitment({ title: '下周交稿', owner: 'user', dueAt: Date.parse(`${nextWeek}T12:00:00`) });
    createCommitment({ title: '给妈妈打电话', owner: 'user', status: 'proposed' });

    const data = buildMorningBriefData();
    expect(data.date).toBe(today);
    expect(data.weatherCity).toBe('大连');
    expect(data.overdueTasks.map((task) => task.title)).toEqual(['昨天就该做']);
    expect(data.todayTasks.map((task) => task.title)).toEqual(['今天要做']);
    expect(data.onceRemindersToday.map((task) => task.name)).toEqual(['交房租']);
    expect(data.recurringReminders.map((task) => task.name)).toEqual(['喝水']);
    expect(data.dueCommitments.map((item) => item.title)).toEqual(['明天回复客户']);
    expect(data.proposedCommitments.map((item) => item.title)).toEqual(['给妈妈打电话']);
    expect(data.goals[0]).toMatchObject({ title: '季度报告', progress: { totalTasks: 3, doneTasks: 1 } });

    const text = formatMorningBrief(data);
    for (const fragment of ['城市「大连」', '逾期待办（1）', '今日到期待办（1）', '交房租（今天 23:30）', '喝水', '答应了 客户', '待确认的承诺', '季度报告：待办 1/3']) {
      expect(text).toContain(fragment);
    }
    expect(text.indexOf('天气')).toBeLessThan(text.indexOf('逾期待办'));
    expect(text.indexOf('今日提醒')).toBeLessThan(text.indexOf('到期的承诺'));
    expect(text.indexOf('待确认的承诺')).toBeLessThan(text.indexOf('目标进度'));
  });

  it('reports missing city and empty sections plainly', () => {
    expect(resolveWeatherCity()).toBeNull();
    const text = formatMorningBrief(buildMorningBriefData());
    expect(text).toContain('未设置城市');
    expect(text).toContain('逾期待办：无');
    expect(text).toContain('目标进度：当前没有进行中的目标');
  });

  it('builds the evening review with evidence and marks overdue commitments missed', () => {
    const done = createUserTask({ title: '已做完', dueAt: today });
    updateUserTask(done.id, { status: 'done' });
    createUserTask({ title: '没做完', dueAt: today });
    const overdue = createCommitment({ title: '早上前回邮件', owner: 'user', dueAt: Date.now() - 60_000 });
    const future = createCommitment({ title: '明天再说', owner: 'user', dueAt: Date.now() + 86_400_000 });
    createTaskRun({ id: 'run-today', sessionId: 's' });
    startTaskRunStep({ runId: 'run-today', callId: 'c1', toolName: 'gen_docx' });
    recordRunArtifacts({
      runId: 'run-today', callId: 'c1', sessionId: 's', toolName: 'gen_docx',
      artifacts: [{ relativePath: 'reports/week.docx', originalName: 'week.docx', size: 10 }],
    });
    finishTaskRun('run-today', { phase: 'finished', terminalReason: 'finished' });
    createTaskRun({ id: 'run-failed', sessionId: 's' });
    finishTaskRun('run-failed', { phase: 'error', terminalReason: 'error', errorSummary: 'x' });

    const data = buildEveningReviewData();
    expect(data.doneToday.map((task) => task.title)).toEqual(['已做完']);
    expect(data.unfinishedDue.map((task) => task.title)).toEqual(['没做完']);
    expect(data.missedCommitments.map((item) => item.id)).toEqual([overdue.id]);
    expect(getCommitment(future.id)?.status).toBe('open');
    expect(data.runsToday).toHaveLength(2);
    expect(data.artifactsToday.map((artifact) => artifact.relativePath)).toEqual(['reports/week.docx']);

    const text = formatEveningReview(data);
    expect(text).toContain('今日完成的待办（1）');
    expect(text).toContain('到期未完成的待办（1，请逐项问顺延/取消/继续）');
    expect(text).toContain('今日错过的承诺');
    expect(text).toContain('今日运行：2 次，其中完成 1，失败或中断 1');
    expect(text).toContain('reports/week.docx（gen_docx');
  });
});
