import { v4 as uuid } from 'uuid';
import { getDatabase, type AppDatabase } from './index';
import type { UserTaskInfo, UserTaskStatus } from '../shared/types';
import { notifyLocalStateChanged } from '../proactivity/signals';

export type { UserTaskInfo, UserTaskStatus } from '../shared/types';

interface UserTaskRow {
  id: string;
  title: string;
  status: string;
  source_file: string | null;
  source_row: number | null;
  module: string | null;
  due_at: string | null;
  notes: string | null;
  goal_id: string | null;
  created_at: number;
  updated_at: number;
}

function rowToInfo(row: UserTaskRow): UserTaskInfo {
  return {
    id: row.id,
    title: row.title,
    status: row.status as UserTaskStatus,
    sourceFile: row.source_file,
    sourceRow: row.source_row,
    module: row.module,
    dueAt: row.due_at,
    notes: row.notes,
    goalId: row.goal_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const TASK_SELECT = `SELECT id, title, status, source_file, source_row, module, due_at, notes, goal_id, created_at, updated_at
  FROM user_tasks`;

export interface UserTaskFilters {
  status?: UserTaskStatus;
  statuses?: UserTaskStatus[];
  module?: string;
  goalId?: string;
  /** 只返回 due_at 不晚于该日期（YYYY-MM-DD）的待办；无截止日期的不包含 */
  dueOnOrBefore?: string;
  /** 只返回 updated_at 不早于该时间戳的待办 */
  updatedSince?: number;
}

export function listUserTasks(
  filters?: UserTaskFilters,
  db: AppDatabase = getDatabase(),
): UserTaskInfo[] {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters?.status) {
    clauses.push('status = ?');
    params.push(filters.status);
  }
  if (filters?.statuses?.length) {
    clauses.push(`status IN (${filters.statuses.map(() => '?').join(', ')})`);
    params.push(...filters.statuses);
  }
  if (filters?.module?.trim()) {
    clauses.push('module = ?');
    params.push(filters.module.trim());
  }
  if (filters?.goalId) {
    clauses.push('goal_id = ?');
    params.push(filters.goalId);
  }
  if (filters?.dueOnOrBefore) {
    clauses.push('due_at IS NOT NULL AND due_at <= ?');
    params.push(filters.dueOnOrBefore);
  }
  if (filters?.updatedSince != null) {
    clauses.push('updated_at >= ?');
    params.push(filters.updatedSince);
  }

  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(`${TASK_SELECT}${where} ORDER BY updated_at DESC`)
    .all(...params) as unknown as UserTaskRow[];
  return rows.map(rowToInfo);
}

export function getUserTask(id: string, db: AppDatabase = getDatabase()): UserTaskInfo | null {
  const row = db
    .prepare(`${TASK_SELECT} WHERE id = ?`)
    .get(id) as unknown as UserTaskRow | undefined;
  return row ? rowToInfo(row) : null;
}

export interface UpsertUserTaskInput {
  title: string;
  status?: UserTaskStatus;
  sourceFile?: string | null;
  sourceRow?: number | null;
  module?: string | null;
  dueAt?: string | null;
  notes?: string | null;
  goalId?: string | null;
}

export function createUserTask(
  input: UpsertUserTaskInput,
  db: AppDatabase = getDatabase(),
): UserTaskInfo {
  const now = Date.now();
  const id = uuid();
  db
    .prepare(
      `INSERT INTO user_tasks (id, title, status, source_file, source_row, module, due_at, notes, goal_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.title.trim(),
      input.status ?? 'pending',
      input.sourceFile ?? null,
      input.sourceRow ?? null,
      input.module ?? null,
      input.dueAt ?? null,
      input.notes ?? null,
      input.goalId ?? null,
      now,
      now,
    );
  notifyLocalStateChanged('task');
  if (input.goalId) notifyLocalStateChanged('goal');
  return getUserTask(id, db)!;
}

export function updateUserTask(
  id: string,
  patch: Partial<UpsertUserTaskInput>,
  db: AppDatabase = getDatabase(),
): UserTaskInfo | null {
  const existing = getUserTask(id, db);
  if (!existing) return null;

  const now = Date.now();
  db
    .prepare(
      `UPDATE user_tasks SET
        title = ?,
        status = ?,
        source_file = ?,
        source_row = ?,
        module = ?,
        due_at = ?,
        notes = ?,
        goal_id = ?,
        updated_at = ?
       WHERE id = ?`,
    )
    .run(
      patch.title?.trim() ?? existing.title,
      patch.status ?? existing.status,
      patch.sourceFile !== undefined ? patch.sourceFile : existing.sourceFile,
      patch.sourceRow !== undefined ? patch.sourceRow : existing.sourceRow,
      patch.module !== undefined ? patch.module : existing.module,
      patch.dueAt !== undefined ? patch.dueAt : existing.dueAt,
      patch.notes !== undefined ? patch.notes : existing.notes,
      patch.goalId !== undefined ? patch.goalId : existing.goalId,
      now,
      id,
    );
  notifyLocalStateChanged('task');
  if (existing.goalId || patch.goalId) notifyLocalStateChanged('goal');
  return getUserTask(id, db);
}

export function findUserTaskBySource(
  sourceFile: string,
  sourceRow: number,
  db: AppDatabase = getDatabase(),
): UserTaskInfo | null {
  const row = db
    .prepare(`${TASK_SELECT} WHERE source_file = ? AND source_row = ?`)
    .get(sourceFile, sourceRow) as unknown as UserTaskRow | undefined;
  return row ? rowToInfo(row) : null;
}

/** Keep task-import transaction ownership inside the database domain boundary. */
export function runUserTaskTransaction<T>(operation: () => T): T {
  return getDatabase().transaction(operation);
}

export function formatUserTaskList(tasks: UserTaskInfo[]): string {
  if (!tasks.length) return '当前没有待办任务。';
  return tasks
    .map((t) => {
      const parts = [
        `- [${t.status}] ${t.title} (id: ${t.id})`,
        t.module ? `  模块: ${t.module}` : null,
        t.dueAt ? `  截止: ${t.dueAt}` : null,
        t.goalId ? `  目标: ${t.goalId}` : null,
        t.notes ? `  备注: ${t.notes}` : null,
        t.sourceFile ? `  来源: ${t.sourceFile}${t.sourceRow != null ? ` 第 ${t.sourceRow} 行` : ''}` : null,
      ].filter(Boolean);
      return parts.join('\n');
    })
    .join('\n');
}
