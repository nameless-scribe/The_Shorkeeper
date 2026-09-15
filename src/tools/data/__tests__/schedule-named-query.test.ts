import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, initDatabase } from '../../../db';
import { createDataSource } from '../../../db/repositories/datasources';
import { listScheduledTasks } from '../../../db/scheduled-tasks';
import { setTaskChangeHandler } from '../../../scheduler/task-events';
import { disableNamedQueryTasksForSource, namedQueryTaskPayload } from '../../../datasources/scheduled-named-queries';
import { parameterizePlan } from '../../../datasources/named-queries';
import { samplePlan } from '../../../datasources/__tests__/fixtures';
import { scheduleNamedQueryTool } from '../schedule-named-query';
import { setDataToolDeps } from '../source-access';

let root: string;
let sourceId: string;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-schedule-nq-'));
  await initDatabase(path.join(root, 'tasks.db'));
  setTaskChangeHandler(() => undefined);
  const source = createDataSource({ name: '生产库', host: 'h', database: 'erp', user: 'u', password: 'p' });
  sourceId = source.id;
});

afterAll(async () => {
  closeDatabase();
  await fs.rm(root, { recursive: true, force: true });
});

beforeEach(() => {
  setDataToolDeps({
    listNamedQueries: () => [{ id: 'nq1', name: '月度客户销售额', question: 'q', planJson: JSON.stringify(parameterizePlan(samplePlan())), notes: null, embedding: null }],
  });
});

const ctx = () => ({ sessionId: 's1', workspaceRoot: root, signal: new AbortController().signal });

describe('schedule_named_query', () => {
  it('creates an agent_prompt task carrying the named query and source, once per schedule', async () => {
    const created = await scheduleNamedQueryTool.execute({ name: '月度客户销售额', cron: '0 9 1 * *', time_range: '上月' }, ctx());
    expect(created.success).toBe(true);
    const task = listScheduledTasks().find((item) => item.id === (created.metadata as { taskId: string }).taskId)!;
    expect(task.actionType).toBe('agent_prompt');
    expect(task.cron).toBe('0 9 1 * *');
    expect(task.name).toBe('定时查询：月度客户销售额');
    const payload = JSON.parse(task.actionPayload) as Record<string, unknown>;
    expect(payload.prompt).toContain('run_named_query');
    expect(payload.timeRange).toBe('上月');
    expect(namedQueryTaskPayload(task.actionPayload)).toEqual({ namedQueryId: 'nq1', sourceId });

    const again = await scheduleNamedQueryTool.execute({ name: '月度客户销售额', cron: '0 9 1 * *', time_range: '上月' }, ctx());
    expect(again.metadata).toMatchObject({ idempotent: true, taskId: task.id });
  });

  it('rejects bad cron, absolute ranges and unknown queries', async () => {
    expect((await scheduleNamedQueryTool.execute({ name: '月度客户销售额', cron: 'nope', time_range: '上月' }, ctx())).error).toContain('cron');
    expect((await scheduleNamedQueryTool.execute({ name: '月度客户销售额', cron: '0 9 * * *', time_range: '2026-08' }, ctx())).error).toContain('相对时间');
    expect((await scheduleNamedQueryTool.execute({ name: '幽灵', cron: '0 9 * * *', time_range: '上月' }, ctx())).error).toContain('没有叫「幽灵」');
  });

  it('disables the tasks of a deleted source and leaves a reason', async () => {
    await scheduleNamedQueryTool.execute({ name: '月度客户销售额', cron: '0 8 * * 1', time_range: '上周', task_name: '每周复盘' }, ctx());
    const disabled = disableNamedQueryTasksForSource(sourceId, '生产库');
    expect(disabled).toContain('每周复盘');
    const tasks = listScheduledTasks().filter((task) => namedQueryTaskPayload(task.actionPayload)?.sourceId === sourceId);
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.every((task) => !task.enabled)).toBe(true);
    expect(tasks[0].lastError).toContain('数据源「生产库」已删除');
    expect(disableNamedQueryTasksForSource(sourceId)).toEqual([]);
  });
});
