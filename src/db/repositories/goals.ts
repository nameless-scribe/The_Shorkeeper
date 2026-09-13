import { v4 as uuidv4 } from 'uuid';
import { getDatabase, type AppDatabase } from '../index';
import type { GoalInfo, GoalProgress, GoalStatus } from '../../shared/types';
import type { GoalRow } from '../schema';

const GOAL_STATUSES: ReadonlySet<string> = new Set<GoalStatus>(['active', 'paused', 'done', 'dropped']);
const CLOSED_GOAL_STATUSES: ReadonlySet<GoalStatus> = new Set(['done', 'dropped']);

export const MAX_GOAL_PRIORITY = 3;

function normalizeStatus(value: string): GoalStatus {
  return GOAL_STATUSES.has(value) ? (value as GoalStatus) : 'active';
}

function clampPriority(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_GOAL_PRIORITY, Math.round(value)));
}

function rowToGoal(row: GoalRow): GoalInfo {
  return {
    id: String(row.id),
    title: String(row.title),
    description: row.description == null ? null : String(row.description),
    status: normalizeStatus(String(row.status)),
    priority: Number(row.priority),
    targetDate: row.target_date == null ? null : String(row.target_date),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    closedAt: row.closed_at == null ? null : Number(row.closed_at),
  };
}

const GOAL_SELECT = `SELECT id, title, description, status, priority, target_date, created_at, updated_at, closed_at
  FROM goals`;

export interface CreateGoalInput {
  title: string;
  description?: string | null;
  priority?: number;
  targetDate?: string | null;
}

export function createGoal(input: CreateGoalInput, db: AppDatabase = getDatabase()): GoalInfo {
  const now = Date.now();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO goals (id, title, description, status, priority, target_date, created_at, updated_at)
     VALUES (?, ?, ?, 'active', ?, ?, ?, ?)`,
  ).run(
    id,
    input.title.trim(),
    input.description?.trim() || null,
    clampPriority(input.priority),
    input.targetDate ?? null,
    now,
    now,
  );
  return getGoal(id, db)!;
}

export function getGoal(id: string, db: AppDatabase = getDatabase()): GoalInfo | null {
  const row = db.prepare(`${GOAL_SELECT} WHERE id = ?`).get(id) as unknown as GoalRow | undefined;
  return row ? rowToGoal(row) : null;
}

export function listGoals(
  options: { status?: GoalStatus; includeClosed?: boolean; limit?: number } = {},
  db: AppDatabase = getDatabase(),
): GoalInfo[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.status) {
    clauses.push('status = ?');
    params.push(options.status);
  } else if (!options.includeClosed) {
    clauses.push(`status IN ('active', 'paused')`);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(200, Math.floor(options.limit ?? 50) || 50));
  const rows = db
    .prepare(`${GOAL_SELECT}${where} ORDER BY status ASC, priority DESC, created_at ASC LIMIT ?`)
    .all(...params, limit) as unknown as GoalRow[];
  return rows.map(rowToGoal);
}

export interface UpdateGoalInput {
  title?: string;
  description?: string | null;
  priority?: number;
  targetDate?: string | null;
  status?: Extract<GoalStatus, 'active' | 'paused'>;
}

export function updateGoal(
  id: string,
  patch: UpdateGoalInput,
  db: AppDatabase = getDatabase(),
): GoalInfo | null {
  const existing = getGoal(id, db);
  if (!existing) return null;
  if (patch.status && CLOSED_GOAL_STATUSES.has(existing.status)) {
    throw new Error('已关闭的目标不能直接改回进行中，请重新创建');
  }
  const now = Date.now();
  db.prepare(
    `UPDATE goals SET title = ?, description = ?, priority = ?, target_date = ?, status = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    patch.title?.trim() || existing.title,
    patch.description !== undefined ? (patch.description?.trim() || null) : existing.description,
    patch.priority !== undefined ? clampPriority(patch.priority) : existing.priority,
    patch.targetDate !== undefined ? patch.targetDate : existing.targetDate,
    patch.status ?? existing.status,
    now,
    id,
  );
  return getGoal(id, db);
}

export function closeGoal(
  id: string,
  status: Extract<GoalStatus, 'done' | 'dropped'>,
  db: AppDatabase = getDatabase(),
): GoalInfo | null {
  const existing = getGoal(id, db);
  if (!existing) return null;
  const now = Date.now();
  db.prepare(
    `UPDATE goals SET status = ?, closed_at = COALESCE(closed_at, ?), updated_at = ? WHERE id = ?`,
  ).run(status, now, now, id);
  return getGoal(id, db);
}

export function getGoalProgress(goalId: string, db: AppDatabase = getDatabase()): GoalProgress {
  const tasks = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done
       FROM user_tasks WHERE goal_id = ? AND status != 'cancelled'`,
    )
    .get(goalId) as { total: number; done: number | null } | undefined;
  const commitments = db
    .prepare(`SELECT COUNT(*) AS open FROM commitments WHERE goal_id = ? AND status = 'open'`)
    .get(goalId) as { open: number } | undefined;
  return {
    totalTasks: Number(tasks?.total ?? 0),
    doneTasks: Number(tasks?.done ?? 0),
    openCommitments: Number(commitments?.open ?? 0),
  };
}

export function formatGoalList(goals: Array<GoalInfo & { progress?: GoalProgress }>): string {
  if (!goals.length) return '当前没有目标。';
  return goals
    .map((goal) => {
      const progress = goal.progress
        ? `  进度: 待办 ${goal.progress.doneTasks}/${goal.progress.totalTasks}，未完成承诺 ${goal.progress.openCommitments}`
        : null;
      return [
        `- [${goal.status}] ${goal.title} (id: ${goal.id})${goal.priority ? ` 优先级 ${goal.priority}` : ''}`,
        goal.targetDate ? `  目标日期: ${goal.targetDate}` : null,
        goal.description ? `  说明: ${goal.description}` : null,
        progress,
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');
}
