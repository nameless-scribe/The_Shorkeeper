import { v4 as uuidv4 } from 'uuid';
import { getDatabase, type AppDatabase } from '../index';
import type {
  CommitmentInfo,
  CommitmentOwner,
  CommitmentStatus,
  UserTaskStatus,
} from '../../shared/types';
import type { CommitmentRow } from '../schema';
import { createUserTask, getUserTask, updateUserTask } from '../user-tasks';

const STATUSES: ReadonlySet<string> = new Set<CommitmentStatus>([
  'proposed',
  'open',
  'done',
  'missed',
  'cancelled',
]);
const TERMINAL: ReadonlySet<CommitmentStatus> = new Set(['done', 'missed', 'cancelled']);

function normalizeStatus(value: string): CommitmentStatus {
  return STATUSES.has(value) ? (value as CommitmentStatus) : 'open';
}

function normalizeOwner(value: string): CommitmentOwner {
  return value === 'assistant' ? 'assistant' : 'user';
}

function rowToCommitment(row: CommitmentRow): CommitmentInfo {
  const text = (value: unknown) => (value == null ? null : String(value));
  const num = (value: unknown) => (value == null ? null : Number(value));
  return {
    id: String(row.id),
    goalId: text(row.goal_id),
    title: String(row.title),
    owner: normalizeOwner(String(row.owner)),
    status: normalizeStatus(String(row.status)),
    dueAt: num(row.due_at),
    promisedTo: text(row.promised_to),
    sourceSessionId: text(row.source_session_id),
    sourceRunId: text(row.source_run_id),
    taskId: text(row.task_id),
    scheduledTaskId: text(row.scheduled_task_id),
    evidenceRunId: text(row.evidence_run_id),
    evidenceArtifactId: text(row.evidence_artifact_id),
    lastFollowedUpAt: num(row.last_followed_up_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    closedAt: num(row.closed_at),
  };
}

const SELECT = `SELECT id, goal_id, title, owner, status, due_at, promised_to, source_session_id, source_run_id,
    task_id, scheduled_task_id, evidence_run_id, evidence_artifact_id, last_followed_up_at,
    created_at, updated_at, closed_at
  FROM commitments`;

export interface CreateCommitmentInput {
  title: string;
  owner: CommitmentOwner;
  status?: Extract<CommitmentStatus, 'proposed' | 'open'>;
  goalId?: string | null;
  dueAt?: number | null;
  promisedTo?: string | null;
  sourceSessionId?: string | null;
  sourceRunId?: string | null;
  taskId?: string | null;
  scheduledTaskId?: string | null;
}

export function createCommitment(
  input: CreateCommitmentInput,
  db: AppDatabase = getDatabase(),
): CommitmentInfo {
  const now = Date.now();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO commitments
       (id, goal_id, title, owner, status, due_at, promised_to, source_session_id, source_run_id,
        task_id, scheduled_task_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.goalId ?? null,
    input.title.trim(),
    input.owner,
    input.status ?? 'open',
    input.dueAt ?? null,
    input.promisedTo?.trim() || null,
    input.sourceSessionId || null,
    input.sourceRunId || null,
    input.taskId ?? null,
    input.scheduledTaskId ?? null,
    now,
    now,
  );
  return getCommitment(id, db)!;
}

export interface CreateUserCommitmentInput extends Omit<CreateCommitmentInput, 'owner'> {
  /** 待办的截止日期 YYYY-MM-DD；缺省从 dueAt 换算不了时留空 */
  dueDate?: string | null;
  module?: string | null;
}

/**
 * 用户承诺必须挂一条待办：给了 taskId 就校验并关联，否则在同一事务中创建同标题的待办。
 */
export function createUserCommitmentWithTask(
  input: CreateUserCommitmentInput,
  db: AppDatabase = getDatabase(),
): { commitment: CommitmentInfo; taskCreated: boolean } {
  return db.transaction(() => {
    let taskId = input.taskId ?? null;
    let taskCreated = false;
    if (taskId) {
      if (!getUserTask(taskId, db)) throw new Error(`未找到待办: ${taskId}`);
    } else {
      const task = createUserTask(
        {
          title: input.title,
          dueAt: input.dueDate ?? null,
          goalId: input.goalId ?? null,
          module: input.module ?? null,
          notes: input.promisedTo ? `承诺对象: ${input.promisedTo}` : null,
        },
        db,
      );
      taskId = task.id;
      taskCreated = true;
    }
    const commitment = createCommitment({ ...input, owner: 'user', taskId }, db);
    return { commitment, taskCreated };
  });
}

export function getCommitment(id: string, db: AppDatabase = getDatabase()): CommitmentInfo | null {
  const row = db.prepare(`${SELECT} WHERE id = ?`).get(id) as unknown as CommitmentRow | undefined;
  return row ? rowToCommitment(row) : null;
}

export interface ListCommitmentsOptions {
  status?: CommitmentStatus;
  statuses?: CommitmentStatus[];
  owner?: CommitmentOwner;
  goalId?: string;
  /** due_at 不晚于该时间（毫秒）；无截止时间的不包含 */
  dueBefore?: number;
  limit?: number;
}

export function listCommitments(
  options: ListCommitmentsOptions = {},
  db: AppDatabase = getDatabase(),
): CommitmentInfo[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.status) {
    clauses.push('status = ?');
    params.push(options.status);
  }
  if (options.statuses?.length) {
    clauses.push(`status IN (${options.statuses.map(() => '?').join(', ')})`);
    params.push(...options.statuses);
  }
  if (options.owner) {
    clauses.push('owner = ?');
    params.push(options.owner);
  }
  if (options.goalId) {
    clauses.push('goal_id = ?');
    params.push(options.goalId);
  }
  if (options.dueBefore != null) {
    clauses.push('due_at IS NOT NULL AND due_at <= ?');
    params.push(options.dueBefore);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 100) || 100));
  const rows = db
    .prepare(`${SELECT}${where} ORDER BY CASE WHEN due_at IS NULL THEN 1 ELSE 0 END, due_at ASC, created_at ASC LIMIT ?`)
    .all(...params, limit) as unknown as CommitmentRow[];
  return rows.map(rowToCommitment);
}

export interface UpdateCommitmentInput {
  title?: string;
  dueAt?: number | null;
  promisedTo?: string | null;
  goalId?: string | null;
  lastFollowedUpAt?: number | null;
}

export function updateCommitment(
  id: string,
  patch: UpdateCommitmentInput,
  db: AppDatabase = getDatabase(),
): CommitmentInfo | null {
  const existing = getCommitment(id, db);
  if (!existing) return null;
  db.prepare(
    `UPDATE commitments
     SET title = ?, due_at = ?, promised_to = ?, goal_id = ?, last_followed_up_at = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    patch.title?.trim() || existing.title,
    patch.dueAt !== undefined ? patch.dueAt : existing.dueAt,
    patch.promisedTo !== undefined ? (patch.promisedTo?.trim() || null) : existing.promisedTo,
    patch.goalId !== undefined ? patch.goalId : existing.goalId,
    patch.lastFollowedUpAt !== undefined ? patch.lastFollowedUpAt : existing.lastFollowedUpAt,
    Date.now(),
    id,
  );
  return getCommitment(id, db);
}

export interface CommitmentEvidence {
  evidenceRunId?: string | null;
  evidenceArtifactId?: string | null;
}

/** 状态变更统一入口：终态记录 closed_at 和证据；回到 open 时清空 closed_at。 */
export function setCommitmentStatus(
  id: string,
  status: Exclude<CommitmentStatus, 'proposed'>,
  evidence: CommitmentEvidence = {},
  db: AppDatabase = getDatabase(),
): CommitmentInfo | null {
  const existing = getCommitment(id, db);
  if (!existing) return null;
  const now = Date.now();
  const terminal = TERMINAL.has(status);
  db.prepare(
    `UPDATE commitments
     SET status = ?, closed_at = ?, evidence_run_id = ?, evidence_artifact_id = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    status,
    terminal ? now : null,
    evidence.evidenceRunId !== undefined ? evidence.evidenceRunId : (terminal ? existing.evidenceRunId : null),
    evidence.evidenceArtifactId !== undefined
      ? evidence.evidenceArtifactId
      : (terminal ? existing.evidenceArtifactId : null),
    now,
    id,
  );
  return getCommitment(id, db);
}

/** proposed → open；没有待办时补建。 */
export function confirmProposedCommitment(
  id: string,
  options: { dueDate?: string | null; goalId?: string | null } = {},
  db: AppDatabase = getDatabase(),
): CommitmentInfo | null {
  return db.transaction(() => {
    const existing = getCommitment(id, db);
    if (!existing) return null;
    if (existing.status !== 'proposed') return existing;
    let taskId = existing.taskId;
    if (!taskId && existing.owner === 'user') {
      taskId = createUserTask(
        {
          title: existing.title,
          dueAt: options.dueDate ?? null,
          goalId: options.goalId ?? existing.goalId,
          notes: existing.promisedTo ? `承诺对象: ${existing.promisedTo}` : null,
        },
        db,
      ).id;
    }
    db.prepare(
      `UPDATE commitments SET status = 'open', task_id = ?, goal_id = ?, updated_at = ? WHERE id = ?`,
    ).run(taskId, options.goalId ?? existing.goalId, Date.now(), id);
    return getCommitment(id, db);
  });
}

export function findCommitmentByTask(taskId: string, db: AppDatabase = getDatabase()): CommitmentInfo | null {
  const row = db
    .prepare(`${SELECT} WHERE task_id = ? ORDER BY created_at DESC LIMIT 1`)
    .get(taskId) as unknown as CommitmentRow | undefined;
  return row ? rowToCommitment(row) : null;
}

export function findCommitmentByScheduledTask(
  scheduledTaskId: string,
  db: AppDatabase = getDatabase(),
): CommitmentInfo | null {
  const row = db
    .prepare(`${SELECT} WHERE scheduled_task_id = ? ORDER BY created_at DESC LIMIT 1`)
    .get(scheduledTaskId) as unknown as CommitmentRow | undefined;
  return row ? rowToCommitment(row) : null;
}

/**
 * 待办状态变化时同步承诺：done → done（带 run 证据），cancelled → cancelled，
 * 重新打开 → open。承诺不存在或已是目标状态时返回 null。
 */
export function syncCommitmentWithTaskStatus(
  taskId: string,
  status: UserTaskStatus,
  evidenceRunId?: string | null,
  db: AppDatabase = getDatabase(),
): CommitmentInfo | null {
  const commitment = findCommitmentByTask(taskId, db);
  if (!commitment || commitment.status === 'proposed') return null;
  const target: Exclude<CommitmentStatus, 'proposed'> = status === 'done'
    ? 'done'
    : status === 'cancelled'
      ? 'cancelled'
      : 'open';
  if (commitment.status === target) return null;
  return setCommitmentStatus(
    commitment.id,
    target,
    target === 'done' ? { evidenceRunId: evidenceRunId ?? null } : {},
    db,
  );
}

/** 承诺完成时把关联待办也标 done，避免两边漂移。 */
export function completeCommitment(
  id: string,
  evidence: CommitmentEvidence = {},
  db: AppDatabase = getDatabase(),
): CommitmentInfo | null {
  return db.transaction(() => {
    const updated = setCommitmentStatus(id, 'done', evidence, db);
    if (updated?.taskId) {
      const task = getUserTask(updated.taskId, db);
      if (task && task.status !== 'done') updateUserTask(task.id, { status: 'done' }, db);
    }
    return updated;
  });
}

export function completeCommitmentForScheduledTask(
  scheduledTaskId: string,
  evidenceRunId?: string | null,
  db: AppDatabase = getDatabase(),
): CommitmentInfo | null {
  const commitment = findCommitmentByScheduledTask(scheduledTaskId, db);
  if (!commitment || commitment.status !== 'open') return null;
  return setCommitmentStatus(commitment.id, 'done', { evidenceRunId: evidenceRunId ?? null }, db);
}

export function cancelCommitmentForScheduledTask(
  scheduledTaskId: string,
  db: AppDatabase = getDatabase(),
): CommitmentInfo | null {
  const commitment = findCommitmentByScheduledTask(scheduledTaskId, db);
  if (!commitment || TERMINAL.has(commitment.status)) return null;
  return setCommitmentStatus(commitment.id, 'cancelled', {}, db);
}

/** 晚间复盘调用：到期仍 open 的承诺标为 missed，不自动顺延。 */
export function markMissedCommitments(now = Date.now(), db: AppDatabase = getDatabase()): CommitmentInfo[] {
  const rows = db
    .prepare(`${SELECT} WHERE status = 'open' AND due_at IS NOT NULL AND due_at < ?`)
    .all(now) as unknown as CommitmentRow[];
  const missed: CommitmentInfo[] = [];
  for (const row of rows) {
    const updated = setCommitmentStatus(String(row.id), 'missed', {}, db);
    if (updated) missed.push(updated);
  }
  return missed;
}

export function formatCommitmentList(commitments: CommitmentInfo[]): string {
  if (!commitments.length) return '当前没有承诺记录。';
  const pad = (value: number) => String(value).padStart(2, '0');
  const formatDue = (dueAt: number | null) => {
    if (dueAt == null) return null;
    const date = new Date(dueAt);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };
  return commitments
    .map((item) => [
      `- [${item.status}] ${item.owner === 'assistant' ? '（助理）' : ''}${item.title} (id: ${item.id})`,
      item.dueAt != null ? `  截止: ${formatDue(item.dueAt)}` : null,
      item.promisedTo ? `  答应了: ${item.promisedTo}` : null,
      item.taskId ? `  关联待办: ${item.taskId}` : null,
      item.scheduledTaskId ? `  关联提醒: ${item.scheduledTaskId}` : null,
      item.goalId ? `  目标: ${item.goalId}` : null,
      item.evidenceRunId ? `  完成证据: run ${item.evidenceRunId}` : null,
    ].filter(Boolean).join('\n'))
    .join('\n');
}
