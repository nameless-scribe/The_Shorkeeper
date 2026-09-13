import { v4 as uuid } from 'uuid';
import { getDatabase } from './index';

export type UserTaskStatus = 'pending' | 'in_progress' | 'done' | 'cancelled';

export interface UserTaskInfo {
  id: string;
  title: string;
  status: UserTaskStatus;
  sourceFile: string | null;
  sourceRow: number | null;
  module: string | null;
  dueAt: string | null;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
}

interface UserTaskRow {
  id: string;
  title: string;
  status: string;
  source_file: string | null;
  source_row: number | null;
  module: string | null;
  due_at: string | null;
  notes: string | null;
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const TASK_SELECT = `SELECT id, title, status, source_file, source_row, module, due_at, notes, created_at, updated_at
  FROM user_tasks`;

export function listUserTasks(filters?: {
  status?: UserTaskStatus;
  module?: string;
}): UserTaskInfo[] {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters?.status) {
    clauses.push('status = ?');
    params.push(filters.status);
  }
  if (filters?.module?.trim()) {
    clauses.push('module = ?');
    params.push(filters.module.trim());
  }

  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const rows = getDatabase()
    .prepare(`${TASK_SELECT}${where} ORDER BY updated_at DESC`)
    .all(...params) as unknown as UserTaskRow[];
  return rows.map(rowToInfo);
}

export function getUserTask(id: string): UserTaskInfo | null {
  const row = getDatabase()
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
}

export function createUserTask(input: UpsertUserTaskInput): UserTaskInfo {
  const now = Date.now();
  const id = uuid();
  getDatabase()
    .prepare(
      `INSERT INTO user_tasks (id, title, status, source_file, source_row, module, due_at, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      now,
      now,
    );
  return getUserTask(id)!;
}

export function updateUserTask(
  id: string,
  patch: Partial<UpsertUserTaskInput>,
): UserTaskInfo | null {
  const existing = getUserTask(id);
  if (!existing) return null;

  const now = Date.now();
  getDatabase()
    .prepare(
      `UPDATE user_tasks SET
        title = ?,
        status = ?,
        source_file = ?,
        source_row = ?,
        module = ?,
        due_at = ?,
        notes = ?,
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
      now,
      id,
    );
  return getUserTask(id);
}

export function findUserTaskBySource(
  sourceFile: string,
  sourceRow: number,
): UserTaskInfo | null {
  const row = getDatabase()
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
        t.notes ? `  备注: ${t.notes}` : null,
        t.sourceFile ? `  来源: ${t.sourceFile}${t.sourceRow != null ? ` 第 ${t.sourceRow} 行` : ''}` : null,
      ].filter(Boolean);
      return parts.join('\n');
    })
    .join('\n');
}
