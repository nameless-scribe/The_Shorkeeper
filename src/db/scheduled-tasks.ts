import cron from 'node-cron';
import { v4 as uuid } from 'uuid';
import { getDatabase } from './index';
import type { ScheduledTaskRow } from './schema';
import type { ScheduleKind, ScheduledTaskInfo } from '../shared/types';
import { validateScheduleInput } from '../scheduler/format';

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
  };
}

const TASK_SELECT = `SELECT id, name, cron, action_type, action_payload, enabled, last_run_at, schedule_kind, run_at
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
      patch.actionType ?? existing.actionType,
      patch.actionPayload ?? existing.actionPayload,
      patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : existing.enabled ? 1 : 0,
      scheduleKind,
      runAt,
      id,
    );

  return getScheduledTask(id);
}

export function disableScheduledTask(id: string): void {
  getDatabase().prepare('UPDATE scheduled_tasks SET enabled = 0 WHERE id = ?').run(id);
}

export function deleteScheduledTask(id: string): boolean {
  getDatabase().prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id);
  return true;
}

export function markTaskRun(id: string): void {
  getDatabase()
    .prepare('UPDATE scheduled_tasks SET last_run_at = ? WHERE id = ?')
    .run(Date.now(), id);
}
