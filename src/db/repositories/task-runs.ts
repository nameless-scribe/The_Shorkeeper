import { v4 as uuidv4 } from 'uuid';
import { getDatabase, type AppDatabase } from '../index';
import type {
  ApprovalDecider,
  ApprovalInfo,
  ApprovalStatus,
  ArtifactInfo,
  TaskRunInfo,
  TaskRunKind,
  TaskRunPhase,
  TaskRunStepInfo,
  TaskRunStepStatus,
  WorkspaceAttachment,
} from '../../shared/types';
import type { ApprovalRow, ArtifactRow, TaskRunRow, TaskRunStepRow } from '../schema';

export const TASK_RUN_TERMINAL_PHASES: ReadonlySet<TaskRunPhase> = new Set([
  'finished',
  'cancelled',
  'error',
  'interrupted',
]);

const RUN_PHASES: ReadonlySet<string> = new Set<TaskRunPhase>([
  'created',
  'running',
  'waiting_tool',
  'waiting_approval',
  'finalizing',
  'finished',
  'cancelled',
  'error',
  'interrupted',
]);

const STEP_STATUSES: ReadonlySet<string> = new Set<TaskRunStepStatus>([
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'skipped',
  'interrupted',
]);

const APPROVAL_STATUSES: ReadonlySet<string> = new Set<ApprovalStatus>([
  'pending',
  'approved',
  'denied',
  'expired',
  'cancelled',
  'interrupted',
]);

const APPROVAL_DECIDERS: ReadonlySet<string> = new Set<ApprovalDecider>([
  'user',
  'timeout',
  'abort',
  'window_closed',
  'startup',
  'error',
]);

export const MAX_ERROR_SUMMARY_CHARS = 500;
export const MAX_ARGS_SUMMARY_CHARS = 2_000;

function truncate(value: string | null | undefined, max: number): string | null {
  if (value == null) return null;
  const text = String(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function normalizeKind(value: string): TaskRunKind {
  return value === 'scheduled' || value === 'voice' ? value : 'chat';
}

function normalizePhase(value: string): TaskRunPhase {
  return RUN_PHASES.has(value) ? (value as TaskRunPhase) : 'error';
}

function normalizeStepStatus(value: string): TaskRunStepStatus {
  return STEP_STATUSES.has(value) ? (value as TaskRunStepStatus) : 'failed';
}

function normalizeApprovalStatus(value: string): ApprovalStatus {
  return APPROVAL_STATUSES.has(value) ? (value as ApprovalStatus) : 'denied';
}

function normalizeDecider(value: string | null): ApprovalDecider | null {
  return value != null && APPROVAL_DECIDERS.has(value) ? (value as ApprovalDecider) : null;
}

function rowToRun(row: TaskRunRow): TaskRunInfo {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    kind: normalizeKind(String(row.kind)),
    triggerRef: row.trigger_ref == null ? null : String(row.trigger_ref),
    phase: normalizePhase(String(row.phase)),
    terminalReason: row.terminal_reason == null ? null : String(row.terminal_reason),
    errorSummary: row.error_summary == null ? null : String(row.error_summary),
    modelId: row.model_id == null ? null : String(row.model_id),
    assistantMessageId: row.assistant_message_id == null ? null : String(row.assistant_message_id),
    stepCount: Number(row.step_count),
    failedStepCount: Number(row.failed_step_count),
    startedAt: Number(row.started_at),
    updatedAt: Number(row.updated_at),
    terminalAt: row.terminal_at == null ? null : Number(row.terminal_at),
    acknowledgedAt: row.acknowledged_at == null ? null : Number(row.acknowledged_at),
  };
}

function rowToStep(row: TaskRunStepRow): TaskRunStepInfo {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    callId: String(row.call_id),
    seq: Number(row.seq),
    toolName: String(row.tool_name),
    status: normalizeStepStatus(String(row.status)),
    errorCategory: row.error_category == null ? null : String(row.error_category),
    errorSummary: row.error_summary == null ? null : String(row.error_summary),
    riskLevel: row.risk_level == null ? null : String(row.risk_level),
    idempotent: Number(row.idempotent) === 1,
    startedAt: Number(row.started_at),
    endedAt: row.ended_at == null ? null : Number(row.ended_at),
  };
}

function rowToArtifact(row: ArtifactRow): ArtifactInfo {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    stepId: row.step_id == null ? null : String(row.step_id),
    sessionId: String(row.session_id),
    toolName: String(row.tool_name),
    relativePath: String(row.relative_path),
    originalName: String(row.original_name),
    size: Number(row.size),
    sha256: row.sha256 == null ? null : String(row.sha256),
    createdAt: Number(row.created_at),
  };
}

function rowToApproval(row: ApprovalRow): ApprovalInfo {
  return {
    id: String(row.id),
    runId: row.run_id == null ? null : String(row.run_id),
    sessionId: row.session_id == null ? null : String(row.session_id),
    toolName: String(row.tool_name),
    argsSummary: String(row.args_summary),
    riskLevel: String(row.risk_level),
    status: normalizeApprovalStatus(String(row.status)),
    decidedBy: normalizeDecider(row.decided_by == null ? null : String(row.decided_by)),
    requestedAt: Number(row.requested_at),
    decidedAt: row.decided_at == null ? null : Number(row.decided_at),
  };
}

const RUN_SELECT = `SELECT id, session_id, kind, trigger_ref, phase, terminal_reason, error_summary,
    model_id, assistant_message_id, step_count, failed_step_count, started_at, updated_at,
    terminal_at, acknowledged_at
  FROM task_runs`;

const STEP_SELECT = `SELECT id, run_id, call_id, seq, tool_name, status, error_category, error_summary,
    risk_level, idempotent, started_at, ended_at
  FROM task_run_steps`;

const ARTIFACT_SELECT = `SELECT id, run_id, step_id, session_id, tool_name, relative_path, original_name,
    size, sha256, created_at
  FROM artifacts`;

const APPROVAL_SELECT = `SELECT id, run_id, session_id, tool_name, args_summary, risk_level, status,
    decided_by, requested_at, decided_at
  FROM approvals`;

export function stepRecordId(runId: string, callId: string): string {
  return `${runId}:${callId}`;
}

// ---------------------------------------------------------------------------
// task_runs
// ---------------------------------------------------------------------------

export interface CreateTaskRunInput {
  id: string;
  sessionId: string;
  kind?: TaskRunKind;
  triggerRef?: string | null;
  modelId?: string | null;
  startedAt?: number;
}

export function createTaskRun(
  input: CreateTaskRunInput,
  db: AppDatabase = getDatabase(),
): TaskRunInfo {
  const now = input.startedAt ?? Date.now();
  db.prepare(
    `INSERT INTO task_runs
       (id, session_id, kind, trigger_ref, phase, model_id, step_count, failed_step_count,
        started_at, updated_at)
     VALUES (?, ?, ?, ?, 'running', ?, 0, 0, ?, ?)`,
  ).run(
    input.id,
    input.sessionId,
    input.kind ?? 'chat',
    input.triggerRef ?? null,
    input.modelId ?? null,
    now,
    now,
  );
  return getTaskRun(input.id, db)!;
}

export function getTaskRun(id: string, db: AppDatabase = getDatabase()): TaskRunInfo | null {
  const row = db.prepare(`${RUN_SELECT} WHERE id = ?`).get(id) as TaskRunRow | undefined;
  return row ? rowToRun(row) : null;
}

export function listTaskRuns(
  options: { sessionId?: string; limit?: number; phases?: TaskRunPhase[]; since?: number } = {},
  db: AppDatabase = getDatabase(),
): TaskRunInfo[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.sessionId) {
    clauses.push('session_id = ?');
    params.push(options.sessionId);
  }
  if (options.since != null) {
    clauses.push('started_at >= ?');
    params.push(options.since);
  }
  if (options.phases?.length) {
    clauses.push(`phase IN (${options.phases.map(() => '?').join(', ')})`);
    params.push(...options.phases);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 50) || 50));
  const rows = db
    .prepare(`${RUN_SELECT}${where} ORDER BY started_at DESC LIMIT ?`)
    .all(...params, limit) as unknown as TaskRunRow[];
  return rows.map(rowToRun);
}

/** 非终态才允许推进阶段；终态由 finishTaskRun 单独收口，避免旧事件回写。 */
export function updateTaskRunPhase(
  id: string,
  phase: Exclude<TaskRunPhase, 'finished' | 'cancelled' | 'error' | 'interrupted'>,
  db: AppDatabase = getDatabase(),
): boolean {
  db.prepare(
    `UPDATE task_runs SET phase = ?, updated_at = ?
     WHERE id = ? AND phase NOT IN ('finished', 'cancelled', 'error', 'interrupted')`,
  ).run(phase, Date.now(), id);
  return getTaskRun(id, db)?.phase === phase;
}

export function setTaskRunModel(
  id: string,
  modelId: string,
  db: AppDatabase = getDatabase(),
): void {
  db.prepare('UPDATE task_runs SET model_id = ?, updated_at = ? WHERE id = ?').run(
    modelId,
    Date.now(),
    id,
  );
}

export interface FinishTaskRunInput {
  phase: Extract<TaskRunPhase, 'finished' | 'cancelled' | 'error'>;
  terminalReason: string;
  errorSummary?: string | null;
  assistantMessageId?: string | null;
}

export function finishTaskRun(
  id: string,
  input: FinishTaskRunInput,
  db: AppDatabase = getDatabase(),
): TaskRunInfo | null {
  const now = Date.now();
  db.prepare(
    `UPDATE task_runs
     SET phase = ?, terminal_reason = ?, error_summary = ?, assistant_message_id = COALESCE(?, assistant_message_id),
         terminal_at = ?, updated_at = ?
     WHERE id = ? AND phase NOT IN ('finished', 'cancelled', 'error', 'interrupted')`,
  ).run(
    input.phase,
    input.terminalReason,
    truncate(input.errorSummary, MAX_ERROR_SUMMARY_CHARS),
    input.assistantMessageId ?? null,
    now,
    now,
    id,
  );
  return getTaskRun(id, db);
}

export function acknowledgeTaskRun(id: string, db: AppDatabase = getDatabase()): void {
  db.prepare('UPDATE task_runs SET acknowledged_at = ? WHERE id = ? AND acknowledged_at IS NULL').run(
    Date.now(),
    id,
  );
}

/**
 * 把该会话所有尚未告知的中断 run 一次性标记为已告知，
 * 避免更早的中断记录在下一轮再冒出来当成"上次运行"。
 */
export function acknowledgeInterruptedRunsForSession(
  sessionId: string,
  db: AppDatabase = getDatabase(),
): number {
  const rows = db
    .prepare(
      `SELECT id FROM task_runs
       WHERE session_id = ? AND phase = 'interrupted' AND acknowledged_at IS NULL`,
    )
    .all(sessionId) as Array<{ id: string }>;
  if (!rows.length) return 0;
  db.prepare(
    `UPDATE task_runs SET acknowledged_at = ?
     WHERE session_id = ? AND phase = 'interrupted' AND acknowledged_at IS NULL`,
  ).run(Date.now(), sessionId);
  return rows.length;
}

/** 最近一次因应用退出被中断、且尚未向用户说明的 run。 */
export function findUnacknowledgedInterruptedRun(
  sessionId: string,
  db: AppDatabase = getDatabase(),
): TaskRunInfo | null {
  const row = db
    .prepare(
      `${RUN_SELECT} WHERE session_id = ? AND phase = 'interrupted' AND acknowledged_at IS NULL
       ORDER BY started_at DESC LIMIT 1`,
    )
    .get(sessionId) as TaskRunRow | undefined;
  return row ? rowToRun(row) : null;
}

export interface InterruptedRunSummary {
  runIds: string[];
  steps: number;
  approvals: number;
}

/**
 * 应用启动时调用：此时进程内没有任何活动 run，因此所有非终态记录都属于上一次进程，
 * 一律标记为 interrupted，确保 "已完成" 状态只来自真实收口。
 */
export function markInterruptedRuns(
  now = Date.now(),
  db: AppDatabase = getDatabase(),
): InterruptedRunSummary {
  return db.transaction(() => {
    const rows = db
      .prepare(
        `SELECT id FROM task_runs
         WHERE phase NOT IN ('finished', 'cancelled', 'error', 'interrupted')`,
      )
      .all() as Array<{ id: string }>;
    const runIds = rows.map((row) => String(row.id));
    if (!runIds.length) return { runIds, steps: 0, approvals: 0 };

    const placeholders = runIds.map(() => '?').join(', ');
    db.prepare(
      `UPDATE task_runs
       SET phase = 'interrupted', terminal_reason = 'process_exit', terminal_at = ?, updated_at = ?
       WHERE id IN (${placeholders})`,
    ).run(now, now, ...runIds);

    const runningSteps = db
      .prepare(
        `SELECT COUNT(*) AS count FROM task_run_steps
         WHERE status = 'running' AND run_id IN (${placeholders})`,
      )
      .get(...runIds) as { count: number } | undefined;
    db.prepare(
      `UPDATE task_run_steps SET status = 'interrupted', ended_at = ?
       WHERE status = 'running' AND run_id IN (${placeholders})`,
    ).run(now, ...runIds);

    const pendingApprovals = db
      .prepare(`SELECT COUNT(*) AS count FROM approvals WHERE status = 'pending'`)
      .get() as { count: number } | undefined;
    db.prepare(
      `UPDATE approvals SET status = 'interrupted', decided_by = 'startup', decided_at = ?
       WHERE status = 'pending'`,
    ).run(now);

    return {
      runIds,
      steps: Number(runningSteps?.count ?? 0),
      approvals: Number(pendingApprovals?.count ?? 0),
    };
  });
}

// ---------------------------------------------------------------------------
// task_run_steps
// ---------------------------------------------------------------------------

export interface StartTaskRunStepInput {
  runId: string;
  callId: string;
  toolName: string;
  riskLevel?: string | null;
  idempotent?: boolean;
  startedAt?: number;
}

export function startTaskRunStep(
  input: StartTaskRunStepInput,
  db: AppDatabase = getDatabase(),
): TaskRunStepInfo {
  const now = input.startedAt ?? Date.now();
  const id = stepRecordId(input.runId, input.callId);
  return db.transaction(() => {
    // 模型重复使用同一 call id 时，主循环会复用首次结果；这里同样只保留首次步骤记录。
    const existing = getTaskRunStep(id, db);
    if (existing) return existing;
    const seqRow = db
      .prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM task_run_steps WHERE run_id = ?')
      .get(input.runId) as { seq: number } | undefined;
    const seq = Number(seqRow?.seq ?? 0) + 1;
    db.prepare(
      `INSERT INTO task_run_steps
         (id, run_id, call_id, seq, tool_name, status, risk_level, idempotent, started_at)
       VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?)`,
    ).run(
      id,
      input.runId,
      input.callId,
      seq,
      input.toolName,
      input.riskLevel ?? null,
      input.idempotent ? 1 : 0,
      now,
    );
    db.prepare('UPDATE task_runs SET step_count = step_count + 1, updated_at = ? WHERE id = ?').run(
      now,
      input.runId,
    );
    return getTaskRunStep(id, db)!;
  });
}

export interface EndTaskRunStepInput {
  status: Exclude<TaskRunStepStatus, 'running' | 'interrupted'>;
  /** skipped 的合并调用不计入失败，也不计入成功步骤。 */
  errorCategory?: string | null;
  errorSummary?: string | null;
  endedAt?: number;
}

export function endTaskRunStep(
  runId: string,
  callId: string,
  input: EndTaskRunStepInput,
  db: AppDatabase = getDatabase(),
): TaskRunStepInfo | null {
  const now = input.endedAt ?? Date.now();
  const id = stepRecordId(runId, callId);
  return db.transaction(() => {
    const existing = getTaskRunStep(id, db);
    if (!existing || existing.status !== 'running') return existing;
    db.prepare(
      `UPDATE task_run_steps
       SET status = ?, error_category = ?, error_summary = ?, ended_at = ?
       WHERE id = ? AND status = 'running'`,
    ).run(
      input.status,
      input.errorCategory ?? null,
      truncate(input.errorSummary, MAX_ERROR_SUMMARY_CHARS),
      now,
      id,
    );
    if (input.status === 'failed') {
      db.prepare(
        'UPDATE task_runs SET failed_step_count = failed_step_count + 1, updated_at = ? WHERE id = ?',
      ).run(now, runId);
    }
    return getTaskRunStep(id, db);
  });
}

export function getTaskRunStep(id: string, db: AppDatabase = getDatabase()): TaskRunStepInfo | null {
  const row = db.prepare(`${STEP_SELECT} WHERE id = ?`).get(id) as TaskRunStepRow | undefined;
  return row ? rowToStep(row) : null;
}

export function listTaskRunSteps(runId: string, db: AppDatabase = getDatabase()): TaskRunStepInfo[] {
  const rows = db
    .prepare(`${STEP_SELECT} WHERE run_id = ? ORDER BY seq ASC`)
    .all(runId) as unknown as TaskRunStepRow[];
  return rows.map(rowToStep);
}

// ---------------------------------------------------------------------------
// artifacts
// ---------------------------------------------------------------------------

export interface RecordArtifactsInput {
  runId: string;
  callId?: string | null;
  sessionId: string;
  toolName: string;
  artifacts: WorkspaceAttachment[];
  createdAt?: number;
}

export function recordRunArtifacts(
  input: RecordArtifactsInput,
  db: AppDatabase = getDatabase(),
): ArtifactInfo[] {
  if (!input.artifacts.length) return [];
  const now = input.createdAt ?? Date.now();
  const stepId = input.callId ? stepRecordId(input.runId, input.callId) : null;
  return db.transaction(() => {
    const created: ArtifactInfo[] = [];
    for (const artifact of input.artifacts) {
      const id = uuidv4();
      db.prepare(
        `INSERT INTO artifacts
           (id, run_id, step_id, session_id, tool_name, relative_path, original_name, size, sha256, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.runId,
        stepId,
        input.sessionId,
        input.toolName,
        artifact.relativePath.replace(/\\/g, '/'),
        artifact.originalName,
        Math.max(0, Math.floor(Number(artifact.size) || 0)),
        artifact.sha256 ?? null,
        now,
      );
      const row = db.prepare(`${ARTIFACT_SELECT} WHERE id = ?`).get(id) as unknown as ArtifactRow;
      created.push(rowToArtifact(row));
    }
    return created;
  });
}

export function listRunArtifacts(runId: string, db: AppDatabase = getDatabase()): ArtifactInfo[] {
  const rows = db
    .prepare(`${ARTIFACT_SELECT} WHERE run_id = ? ORDER BY created_at ASC`)
    .all(runId) as unknown as ArtifactRow[];
  return rows.map(rowToArtifact);
}

export function listArtifactsSince(
  since: number,
  limit = 100,
  db: AppDatabase = getDatabase(),
): ArtifactInfo[] {
  const rows = db
    .prepare(`${ARTIFACT_SELECT} WHERE created_at >= ? ORDER BY created_at ASC LIMIT ?`)
    .all(since, Math.max(1, Math.min(500, Math.floor(limit) || 100))) as unknown as ArtifactRow[];
  return rows.map(rowToArtifact);
}

export function listSessionArtifacts(
  sessionId: string,
  limit = 50,
  db: AppDatabase = getDatabase(),
): ArtifactInfo[] {
  const rows = db
    .prepare(`${ARTIFACT_SELECT} WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`)
    .all(sessionId, Math.max(1, Math.min(500, Math.floor(limit) || 50))) as unknown as ArtifactRow[];
  return rows.map(rowToArtifact);
}

// ---------------------------------------------------------------------------
// approvals
// ---------------------------------------------------------------------------

export interface CreateApprovalInput {
  id?: string;
  runId?: string | null;
  sessionId?: string | null;
  toolName: string;
  args: unknown;
  riskLevel: string;
  requestedAt?: number;
}

export function summarizeApprovalArgs(args: unknown): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(args ?? null) ?? 'null';
  } catch {
    serialized = '[unserializable]';
  }
  return truncate(serialized, MAX_ARGS_SUMMARY_CHARS) ?? 'null';
}

export function createApproval(
  input: CreateApprovalInput,
  db: AppDatabase = getDatabase(),
): ApprovalInfo {
  const id = input.id ?? uuidv4();
  const now = input.requestedAt ?? Date.now();
  db.prepare(
    `INSERT INTO approvals
       (id, run_id, session_id, tool_name, args_summary, risk_level, status, requested_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
  ).run(
    id,
    input.runId ?? null,
    input.sessionId ?? null,
    input.toolName,
    summarizeApprovalArgs(input.args),
    input.riskLevel,
    now,
  );
  return getApproval(id, db)!;
}

export function decideApproval(
  id: string,
  status: Exclude<ApprovalStatus, 'pending' | 'interrupted'>,
  decidedBy: ApprovalDecider,
  db: AppDatabase = getDatabase(),
): ApprovalInfo | null {
  db.prepare(
    `UPDATE approvals SET status = ?, decided_by = ?, decided_at = ?
     WHERE id = ? AND status = 'pending'`,
  ).run(status, decidedBy, Date.now(), id);
  return getApproval(id, db);
}

export function getApproval(id: string, db: AppDatabase = getDatabase()): ApprovalInfo | null {
  const row = db.prepare(`${APPROVAL_SELECT} WHERE id = ?`).get(id) as ApprovalRow | undefined;
  return row ? rowToApproval(row) : null;
}

export function listApprovals(
  options: { runId?: string; status?: ApprovalStatus; limit?: number } = {},
  db: AppDatabase = getDatabase(),
): ApprovalInfo[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.runId) {
    clauses.push('run_id = ?');
    params.push(options.runId);
  }
  if (options.status) {
    clauses.push('status = ?');
    params.push(options.status);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 50) || 50));
  const rows = db
    .prepare(`${APPROVAL_SELECT}${where} ORDER BY requested_at DESC LIMIT ?`)
    .all(...params, limit) as unknown as ApprovalRow[];
  return rows.map(rowToApproval);
}
