import { v4 as uuid } from 'uuid';
import { getDatabase } from './index';
import type { ScheduledTaskRow } from './schema';

import type { ScheduledTaskInfo } from '../shared/types';

function rowToInfo(row: ScheduledTaskRow): ScheduledTaskInfo {
  return {
    id: row.id,
    name: row.name,
    cron: row.cron,
    actionType: row.action_type,
    actionPayload: row.action_payload,
    enabled: row.enabled === 1,
    lastRunAt: row.last_run_at,
  };
}

export function listScheduledTasks(): ScheduledTaskInfo[] {
  const rows = getDatabase()
    .prepare(
      `SELECT id, name, cron, action_type, action_payload, enabled, last_run_at
       FROM scheduled_tasks ORDER BY name ASC`,
    )
    .all() as unknown as ScheduledTaskRow[];
  return rows.map(rowToInfo);
}

export function listEnabledScheduledTasks(): ScheduledTaskInfo[] {
  return listScheduledTasks().filter((t) => t.enabled);
}

export function createScheduledTask(input: {
  name: string;
  cron: string;
  actionType: string;
  actionPayload: string;
  enabled?: boolean;
}): ScheduledTaskInfo {
  const id = uuid();
  getDatabase()
    .prepare(
      `INSERT INTO scheduled_tasks (id, name, cron, action_type, action_payload, enabled)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.name,
      input.cron,
      input.actionType,
      input.actionPayload,
      input.enabled === false ? 0 : 1,
    );
  return rowToInfo(
    getDatabase()
      .prepare(
        `SELECT id, name, cron, action_type, action_payload, enabled, last_run_at
         FROM scheduled_tasks WHERE id = ?`,
      )
      .get(id) as unknown as ScheduledTaskRow,
  );
}

export function updateScheduledTask(
  id: string,
  patch: Partial<{
    name: string;
    cron: string;
    actionType: string;
    actionPayload: string;
    enabled: boolean;
  }>,
): ScheduledTaskInfo | null {
  const existing = getDatabase()
    .prepare(
      `SELECT id, name, cron, action_type, action_payload, enabled, last_run_at
       FROM scheduled_tasks WHERE id = ?`,
    )
    .get(id) as unknown as ScheduledTaskRow | undefined;
  if (!existing) return null;

  getDatabase()
    .prepare(
      `UPDATE scheduled_tasks
       SET name = ?, cron = ?, action_type = ?, action_payload = ?, enabled = ?
       WHERE id = ?`,
    )
    .run(
      patch.name ?? existing.name,
      patch.cron ?? existing.cron,
      patch.actionType ?? existing.action_type,
      patch.actionPayload ?? existing.action_payload,
      patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : existing.enabled,
      id,
    );

  return rowToInfo(
    getDatabase()
      .prepare(
        `SELECT id, name, cron, action_type, action_payload, enabled, last_run_at
         FROM scheduled_tasks WHERE id = ?`,
      )
      .get(id) as unknown as ScheduledTaskRow,
  );
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
