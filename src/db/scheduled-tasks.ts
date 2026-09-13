import cron from 'node-cron';
import { v4 as uuid } from 'uuid';
import { getDatabase } from './index';
import type { ScheduledTaskRow } from './schema';
import type { ScheduleKind, ScheduledTaskInfo } from '../shared/types';
import { validateScheduleInput } from '../scheduler/format';
import { notifyLocalStateChanged } from '../proactivity/signals';

function rowToInfo(row: ScheduledTaskRow): ScheduledTaskInfo {
  const scheduleKind = (row.schedule_kind === 'once' ? 'once' : 'recurring') as ScheduleKind;
  return {
    id: row.id,
    name: row.name,
    scheduleKind,
    cron: row.cron,
    runAt: row.run_at,
    actionType: row.action_type,
    actionPayload: row.action_payload,
    enabled: row.enabled === 1,
    lastRunAt: row.last_run_at,
    lastError: row.last_error ?? null,
    lastErrorAt: row.last_error_at ?? null,
    failureCount: Number(row.failure_count ?? 0),
  };
}

const TASK_SELECT = `SELECT id, name, cron, action_type, action_payload, enabled, last_run_at, schedule_kind, run_at,
    last_error, last_error_at, failure_count
  FROM scheduled_tasks`;

export function listScheduledTasks(): ScheduledTaskInfo[] {
  const rows = getDatabase().prepare(`${TASK_SELECT} ORDER BY name ASC`).all() as unknown as ScheduledTaskRow[];
  return rows.map(rowToInfo);
}

export function listEnabledScheduledTasks(): ScheduledTaskInfo[] {
  return listScheduledTasks().filter((t) => t.enabled);
}

export function getScheduledTask(id: string): ScheduledTaskInfo | null {
  const row = getDatabase()
    .prepare(`${TASK_SELECT} WHERE id = ?`)
    .get(id) as unknown as ScheduledTaskRow | undefined;
  return row ? rowToInfo(row) : null;
}

export interface CreateScheduledTaskInput {
  name: string;
  scheduleKind?: ScheduleKind;
  cron?: string;
  runAt?: number | null;
  actionType: string;
  actionPayload: string;
  enabled?: boolean;
}

function validateActionType(actionType: string): void {
  if (actionType !== 'reminder' && actionType !== 'agent_prompt') {
    throw new Error(`不支持的定时任务动作: ${actionType}`);
  }
}

function validateCron(expression: string): string | null {
  const trimmed = expression.trim();
  if (!trimmed) return 'cron 表达式不能为空';
  if (!cron.validate(trimmed)) return `无效的 cron 表达式: ${trimmed}`;
  return null;
}

export function createScheduledTask(input: CreateScheduledTaskInput): ScheduledTaskInfo {
  const scheduleKind = input.scheduleKind ?? 'recurring';
  const cronExpr = input.cron?.trim() ?? '';
  const runAt = input.runAt ?? null;
  validateActionType(input.actionType);

  const scheduleError = validateScheduleInput({ scheduleKind, cron: cronExpr, runAt });
  if (scheduleError) {
    throw new Error(scheduleError);
  }
  if (scheduleKind === 'recurring') {
    const cronError = validateCron(cronExpr);
    if (cronError) throw new Error(cronError);
  }

  const id = uuid();
  getDatabase()
    .prepare(
      `INSERT INTO scheduled_tasks (id, name, cron, action_type, action_payload, enabled, schedule_kind, run_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.name,
      scheduleKind === 'once' ? '' : cronExpr,
      input.actionType,
      input.actionPayload,
      input.enabled === false ? 0 : 1,
      scheduleKind,
      runAt,
    );

  notifyLocalStateChanged('schedule');
  return getScheduledTask(id)!;
}

export function updateScheduledTask(
  id: string,
  patch: Partial<{
    name: string;
    scheduleKind: ScheduleKind;
    cron: string;
    runAt: number | null;
    actionType: string;
    actionPayload: string;
    enabled: boolean;
  }>,
): ScheduledTaskInfo | null {
  const existing = getScheduledTask(id);
  if (!existing) return null;

  const scheduleKind = patch.scheduleKind ?? existing.scheduleKind;
  const cronExpr = patch.cron ?? existing.cron;
  const runAt = patch.runAt !== undefined ? patch.runAt : existing.runAt;
  const actionType = patch.actionType ?? existing.actionType;
  validateActionType(actionType);

  const scheduleError = validateScheduleInput({ scheduleKind, cron: cronExpr, runAt });
  if (scheduleError) {
    throw new Error(scheduleError);
  }

  getDatabase()
    .prepare(
      `UPDATE scheduled_tasks
       SET name = ?, cron = ?, action_type = ?, action_payload = ?, enabled = ?, schedule_kind = ?, run_at = ?
       WHERE id = ?`,
    )
    .run(
      patch.name ?? existing.name,
      scheduleKind === 'once' ? '' : cronExpr,
      actionType,
      patch.actionPayload ?? existing.actionPayload,
      patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : existing.enabled ? 1 : 0,
      scheduleKind,
      runAt,
      id,
    );

  notifyLocalStateChanged('schedule');
  return getScheduledTask(id);
}

export function disableScheduledTask(id: string): void {
  getDatabase().prepare('UPDATE scheduled_tasks SET enabled = 0 WHERE id = ?').run(id);
  notifyLocalStateChanged('schedule');
}

export function deleteScheduledTask(id: string): boolean {
  const db = getDatabase();
  const existing = db.prepare('SELECT id FROM scheduled_tasks WHERE id = ?').get(id);
  if (!existing) return false;
  db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id);
  notifyLocalStateChanged('schedule');
  return true;
}

/** 成功执行：记录时间并清零失败计数，让"定时任务失败"事件可以因下次成功自动解除。 */
export function markTaskRun(id: string): void {
  getDatabase()
    .prepare('UPDATE scheduled_tasks SET last_run_at = ?, failure_count = 0, last_error = NULL, last_error_at = NULL WHERE id = ?')
    .run(Date.now(), id);
  notifyLocalStateChanged('schedule');
}

const MAX_TASK_ERROR_CHARS = 200;

/** 执行失败：持久化错误摘要与连续失败次数，作为 P3 主动事件的真源。 */
export function markTaskFailure(id: string, error: unknown, at = Date.now()): void {
  const raw = error instanceof Error ? error.message : String(error ?? '未知错误');
  const summary = raw.trim().slice(0, MAX_TASK_ERROR_CHARS) || '未知错误';
  getDatabase()
    .prepare(
      `UPDATE scheduled_tasks
       SET last_error = ?, last_error_at = ?, failure_count = COALESCE(failure_count, 0) + 1
       WHERE id = ?`,
    )
    .run(summary, at, id);
  notifyLocalStateChanged('schedule');
}
