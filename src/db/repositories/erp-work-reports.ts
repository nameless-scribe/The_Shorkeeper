import { v4 as uuidv4 } from 'uuid';
import { getDatabase, type AppDatabase } from '../index';
import type { ErpReportBatchRow, ErpReportDraftRow, ErpReportSubmissionRow } from '../schema';
import type { ErpRunReportInfo } from '../../shared/types';
import { getApproval, getTaskRunStep, stepRecordId } from './task-runs';
import {
  canonicalJson,
  digestErpPayload,
  ERP_REPORT_MAX_SOURCE_REFS,
  isIsoDate,
  normalizeErpOrigin,
  parseDraftItems,
  validateDraftForSubmission,
  type ErpReportBatchStatus,
  type ErpReportDraftInput,
  type ErpReportDraftItem,
  type ErpReportDraftStatus,
  type ErpReportSubmissionState,
} from '../../erp/contracts';

const MAX_ERROR_CODE_CHARS = 100;

export interface ErpReportDraftInfo {
  id: string;
  sessionId: string;
  connectionKey: string;
  erpOrigin: string;
  erpUserId: string | null;
  workDate: string;
  revision: number;
  status: ErpReportDraftStatus;
  items: ErpReportDraftItem[];
  sourceMessageIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ErpReportBatchInfo {
  id: string;
  draftId: string;
  draftRevision: number;
  payload: Record<string, unknown>;
  payloadDigest: string;
  previewRevision: string;
  approvalId: string;
  authorizedRunId: string;
  executionStatus: ErpReportBatchStatus;
  activeClaimKey: string | null;
  claimRunId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ErpReportSubmissionInfo {
  id: string;
  logicalOperationId: string;
  batchId: string;
  itemId: string;
  attemptNo: number;
  previousAttemptId: string | null;
  runId: string;
  stepId: string;
  callId: string;
  approvalId: string;
  state: ErpReportSubmissionState;
  requestDigest: string;
  beforeEntryIds: string[];
  remoteTimeEntryId: string | null;
  evidence: Record<string, unknown> | null;
  errorCode: string | null;
  createdAt: number;
  sentAt: number | null;
  updatedAt: number;
}

const DRAFT_SELECT = `SELECT id, session_id, connection_key, erp_origin, erp_user_id, work_date,
  revision, status, items_json, source_message_ids_json, created_at, updated_at FROM erp_report_drafts`;
const BATCH_SELECT = `SELECT id, draft_id, draft_revision, payload_json, payload_digest, preview_revision,
  approval_id, authorized_run_id, execution_status, active_claim_key, claim_run_id, created_at, updated_at
  FROM erp_report_batches`;
const SUBMISSION_SELECT = `SELECT id, logical_operation_id, batch_id, item_id, attempt_no,
  previous_attempt_id, run_id, step_id, call_id, approval_id, state, request_digest,
  before_entries_json, remote_time_entry_id, evidence_json, error_code, created_at, sent_at, updated_at
  FROM erp_report_submissions`;

function parseJson<T>(value: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`${label}已损坏，已停止 ERP 报工`);
  }
}

function draftFromRow(row: ErpReportDraftRow): ErpReportDraftInfo {
  return {
    id: String(row.id), sessionId: String(row.session_id), connectionKey: String(row.connection_key),
    erpOrigin: String(row.erp_origin), erpUserId: row.erp_user_id == null ? null : String(row.erp_user_id),
    workDate: String(row.work_date), revision: Number(row.revision), status: row.status as ErpReportDraftStatus,
    items: parseDraftItems(parseJson<{ items: unknown }>(String(row.items_json), '报工草稿').items),
    sourceMessageIds: parseJson<string[]>(String(row.source_message_ids_json), '报工来源'),
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  };
}

function batchFromRow(row: ErpReportBatchRow): ErpReportBatchInfo {
  return {
    id: String(row.id), draftId: String(row.draft_id), draftRevision: Number(row.draft_revision),
    payload: parseJson<Record<string, unknown>>(String(row.payload_json), '报工批次'),
    payloadDigest: String(row.payload_digest), previewRevision: String(row.preview_revision),
    approvalId: String(row.approval_id), authorizedRunId: String(row.authorized_run_id),
    executionStatus: row.execution_status as ErpReportBatchStatus,
    activeClaimKey: row.active_claim_key == null ? null : String(row.active_claim_key),
    claimRunId: row.claim_run_id == null ? null : String(row.claim_run_id),
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  };
}

function submissionFromRow(row: ErpReportSubmissionRow): ErpReportSubmissionInfo {
  return {
    id: String(row.id), logicalOperationId: String(row.logical_operation_id), batchId: String(row.batch_id),
    itemId: String(row.item_id), attemptNo: Number(row.attempt_no),
    previousAttemptId: row.previous_attempt_id == null ? null : String(row.previous_attempt_id),
    runId: String(row.run_id), stepId: String(row.step_id), callId: String(row.call_id),
    approvalId: String(row.approval_id), state: row.state as ErpReportSubmissionState,
    requestDigest: String(row.request_digest),
    beforeEntryIds: parseJson<string[]>(String(row.before_entries_json), '报工发送基线'),
    remoteTimeEntryId: row.remote_time_entry_id == null ? null : String(row.remote_time_entry_id),
    evidence: row.evidence_json == null ? null : parseJson<Record<string, unknown>>(String(row.evidence_json), '报工核验证据'),
    errorCode: row.error_code == null ? null : String(row.error_code),
    createdAt: Number(row.created_at), sentAt: row.sent_at == null ? null : Number(row.sent_at),
    updatedAt: Number(row.updated_at),
  };
}

function uniqueStrings(values: string[]): string[] {
  const result = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (result.length > ERP_REPORT_MAX_SOURCE_REFS) throw new Error(`来源消息最多 ${ERP_REPORT_MAX_SOURCE_REFS} 条`);
  return result;
}

export function createErpReportDraft(input: ErpReportDraftInput, db: AppDatabase = getDatabase(), now = Date.now()): ErpReportDraftInfo {
  if (!isIsoDate(input.workDate)) throw new Error('报工日期必须是有效的 YYYY-MM-DD');
  const items = parseDraftItems(input.items);
  const validation = validateDraftForSubmission(items);
  const sourceIds = uniqueStrings(input.sourceMessageIds ?? items.flatMap((item) => item.sourceMessageIds));
  const id = uuidv4();
  db.prepare(`INSERT INTO erp_report_drafts
    (id, session_id, connection_key, erp_origin, erp_user_id, work_date, revision, status,
     items_json, source_message_ids_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`)
    .run(id, input.sessionId, input.connectionKey, normalizeErpOrigin(input.erpOrigin), input.erpUserId ?? null,
      input.workDate, validation.ready ? 'ready' : 'draft', canonicalJson({ items }), canonicalJson(sourceIds), now, now);
  return getErpReportDraft(id, db)!;
}

export function getErpReportDraft(id: string, db: AppDatabase = getDatabase()): ErpReportDraftInfo | null {
  const row = db.prepare(`${DRAFT_SELECT} WHERE id = ?`).get(id) as unknown as ErpReportDraftRow | undefined;
  return row ? draftFromRow(row) : null;
}

export function findOpenErpReportDraft(sessionId: string, workDate: string, db: AppDatabase = getDatabase()): ErpReportDraftInfo | null {
  const row = db.prepare(`${DRAFT_SELECT} WHERE session_id = ? AND work_date = ? AND status IN ('draft', 'ready') ORDER BY updated_at DESC LIMIT 1`)
    .get(sessionId, workDate) as unknown as ErpReportDraftRow | undefined;
  return row ? draftFromRow(row) : null;
}

export function updateErpReportDraft(
  id: string,
  expectedRevision: number,
  patch: { items: ErpReportDraftItem[]; erpUserId?: string | null; sourceMessageIds?: string[] },
  db: AppDatabase = getDatabase(),
  now = Date.now(),
): ErpReportDraftInfo | null {
  const items = parseDraftItems(patch.items);
  const validation = validateDraftForSubmission(items);
  const current = getErpReportDraft(id, db);
  if (!current || current.revision !== expectedRevision || current.status === 'submitted' || current.status === 'cancelled') return null;
  const sourceIds = uniqueStrings(patch.sourceMessageIds ?? items.flatMap((item) => item.sourceMessageIds));
  db.prepare(`UPDATE erp_report_drafts SET erp_user_id = ?, items_json = ?, source_message_ids_json = ?,
    status = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ? AND status IN ('draft', 'ready')`)
    .run(patch.erpUserId === undefined ? current.erpUserId : patch.erpUserId, canonicalJson({ items }), canonicalJson(sourceIds),
      validation.ready ? 'ready' : 'draft', now, id, expectedRevision);
  const updated = getErpReportDraft(id, db);
  return updated?.revision === expectedRevision + 1 ? updated : null;
}

export interface FreezeErpReportBatchInput {
  draftId: string;
  draftRevision: number;
  previewRevision: string;
  approvalId: string;
  authorizedRunId: string;
  authorization?: {
    sessionId: string;
    callId: string;
    argsDigest: string;
    toolName: string;
  };
}

export function freezeErpReportBatch(input: FreezeErpReportBatchInput, db: AppDatabase = getDatabase(), now = Date.now()): ErpReportBatchInfo {
  return db.transaction(() => {
    const existing = db.prepare(`${BATCH_SELECT} WHERE draft_id = ? AND draft_revision = ?`).get(input.draftId, input.draftRevision) as unknown as ErpReportBatchRow | undefined;
    if (existing) {
      const batch = batchFromRow(existing);
      if (batch.approvalId !== input.approvalId
          || batch.authorizedRunId !== input.authorizedRunId
          || batch.previewRevision !== input.previewRevision) {
        throw new Error('该草稿版本已由另一条审批冻结，不能替换授权');
      }
      return batch;
    }
    const draft = getErpReportDraft(input.draftId, db);
    if (!draft || draft.revision !== input.draftRevision || draft.status !== 'ready') throw new Error('报工草稿已变化或尚未就绪');
    if (!draft.erpUserId) throw new Error('尚未绑定当前 ERP 用户');
    if (input.authorization) {
      const approval = getApproval(input.approvalId, db);
      const step = getTaskRunStep(stepRecordId(input.authorizedRunId, input.authorization.callId), db);
      if (!approval
          || approval.status !== 'approved'
          || approval.decidedBy !== 'user'
          || approval.runId !== input.authorizedRunId
          || approval.sessionId !== input.authorization.sessionId
          || approval.callId !== input.authorization.callId
          || approval.toolName !== input.authorization.toolName
          || approval.argsDigest !== input.authorization.argsDigest
          || approval.previewRevision !== input.previewRevision) {
        throw new Error('报工审批凭据与当前调用不一致');
      }
      if (!step
          || step.status !== 'running'
          || step.runId !== input.authorizedRunId
          || step.callId !== input.authorization.callId
          || step.toolName !== input.authorization.toolName) {
        throw new Error('报工调用步骤未可靠记录');
      }
      if (draft.sessionId !== input.authorization.sessionId) throw new Error('报工草稿不属于当前会话');
    }
    const payload = {
      draftId: draft.id, draftRevision: draft.revision, connectionKey: draft.connectionKey,
      erpOrigin: draft.erpOrigin, erpUserId: draft.erpUserId, workDate: draft.workDate, items: draft.items,
    };
    const id = uuidv4();
    db.prepare(`INSERT INTO erp_report_batches
      (id, draft_id, draft_revision, payload_json, payload_digest, preview_revision, approval_id,
       authorized_run_id, execution_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?)`)
      .run(id, draft.id, draft.revision, canonicalJson(payload), digestErpPayload(payload), input.previewRevision,
        input.approvalId, input.authorizedRunId, now, now);
    return getErpReportBatch(id, db)!;
  });
}

export function getErpReportBatch(id: string, db: AppDatabase = getDatabase()): ErpReportBatchInfo | null {
  const row = db.prepare(`${BATCH_SELECT} WHERE id = ?`).get(id) as unknown as ErpReportBatchRow | undefined;
  return row ? batchFromRow(row) : null;
}

/** Read-only business details for the existing run history; all item text comes from the frozen batch. */
export function listErpRunReports(runId: string, db: AppDatabase = getDatabase()): ErpRunReportInfo[] {
  const rows = db.prepare(`SELECT b.id FROM erp_report_batches b
    WHERE b.authorized_run_id = ? OR EXISTS (
      SELECT 1 FROM erp_report_submissions s WHERE s.batch_id = b.id AND s.run_id = ?
    ) ORDER BY b.created_at DESC LIMIT 120`).all(runId, runId) as Array<{ id: string }>;
  return rows.map(({ id }) => {
    const batch = getErpReportBatch(id, db)!;
    if (digestErpPayload(batch.payload) !== batch.payloadDigest) throw new Error('ERP 报工批次快照校验失败');
    const userId = batch.payload.erpUserId;
    const workDate = batch.payload.workDate;
    if (typeof userId !== 'string' || !userId || typeof workDate !== 'string' || !isIsoDate(workDate)) {
      throw new Error('ERP 报工批次快照已损坏');
    }
    const items = parseDraftItems(batch.payload.items);
    const latestRows = db.prepare(`SELECT s.item_id, s.state, s.remote_time_entry_id
      FROM erp_report_submissions s WHERE s.batch_id = ? AND s.attempt_no = (
        SELECT MAX(next.attempt_no) FROM erp_report_submissions next
        WHERE next.logical_operation_id = s.logical_operation_id
      )`).all(id) as Array<{ item_id: string; state: ErpReportSubmissionState; remote_time_entry_id: string | null }>;
    const latest = new Map(latestRows.map((row) => [row.item_id, row]));
    const currentRunRows = db.prepare(`SELECT DISTINCT item_id FROM erp_report_submissions
      WHERE batch_id = ? AND run_id = ?`).all(id, runId) as Array<{ item_id: string }>;
    const attemptedInRun = new Set(currentRunRows.map((row) => row.item_id));
    return {
      batchId: batch.id, workDate, erpUserId: userId, status: batch.executionStatus,
      items: items.map((item) => ({
        itemId: item.itemId, taskName: item.taskName, projectName: item.projectName,
        workMinutes: item.workMinutes!, workContent: item.workContent,
        state: latest.get(item.itemId)?.state ?? 'not_started',
        attemptedInRun: attemptedInRun.has(item.itemId),
        remoteTimeEntryId: latest.get(item.itemId)?.remote_time_entry_id ?? null,
      })),
    };
  });
}

function claimErpReportBatchInTransaction(
  id: string, claimKey: string, runId: string, allowedStatuses: ErpReportBatchStatus[], db: AppDatabase, now: number,
): boolean {
  const batch = getErpReportBatch(id, db);
  if (!batch || batch.activeClaimKey !== null || !allowedStatuses.includes(batch.executionStatus)) return false;
  const draft = getErpReportDraft(batch.draftId, db);
  if (!draft?.erpUserId || claimKey !== `${draft.connectionKey}|${draft.erpUserId}|${draft.workDate}`) return false;
  const occupied = db.prepare(`SELECT id FROM erp_report_batches WHERE active_claim_key IS NOT NULL AND id <> ? LIMIT 1`)
    .get(id) as { id?: unknown } | undefined;
  if (occupied) return false;
  const unresolved = db.prepare(`SELECT s.id FROM erp_report_submissions s
      JOIN erp_report_batches b ON b.id = s.batch_id
      JOIN erp_report_drafts d ON d.id = b.draft_id
      WHERE d.connection_key = ? AND d.erp_user_id = ? AND d.work_date = ?
        AND s.state IN ('dispatching', 'verifying', 'unknown') LIMIT 1`)
    .get(draft.connectionKey, draft.erpUserId, draft.workDate) as { id?: unknown } | undefined;
  if (unresolved) return false;
  db.prepare(`UPDATE erp_report_batches SET execution_status = 'running', active_claim_key = ?, claim_run_id = ?, updated_at = ?
      WHERE id = ? AND execution_status = ? AND active_claim_key IS NULL`)
    .run(claimKey, runId, now, id, batch.executionStatus);
  const row = getErpReportBatch(id, db);
  return row?.activeClaimKey === claimKey && row.claimRunId === runId;
}

export function claimErpReportBatch(id: string, claimKey: string, runId: string, db: AppDatabase = getDatabase(), now = Date.now()): boolean {
  return db.transaction(() => claimErpReportBatchInTransaction(id, claimKey, runId, ['approved'], db, now));
}

export interface ErpResumeAuthorization {
  sessionId: string;
  runId: string;
  callId: string;
  toolName: string;
  approvalId: string;
  argsDigest: string;
  previewRevision: string;
}

export function claimErpReportBatchForResume(
  id: string,
  claimKey: string,
  authorization: ErpResumeAuthorization,
  db: AppDatabase = getDatabase(),
  now = Date.now(),
): boolean {
  return db.transaction(() => {
    const batch = getErpReportBatch(id, db);
    if (!batch || !['partially_verified', 'cancelled', 'failed'].includes(batch.executionStatus)) return false;
    const draft = getErpReportDraft(batch.draftId, db);
    if (!draft || draft.sessionId !== authorization.sessionId) throw new Error('报工批次不属于当前会话');
    const approval = getApproval(authorization.approvalId, db);
    const step = getTaskRunStep(stepRecordId(authorization.runId, authorization.callId), db);
    if (!approval || approval.id === batch.approvalId
        || approval.status !== 'approved' || approval.decidedBy !== 'user'
        || approval.runId !== authorization.runId || approval.sessionId !== authorization.sessionId
        || approval.callId !== authorization.callId || approval.toolName !== authorization.toolName
        || approval.argsDigest !== authorization.argsDigest || approval.previewRevision !== authorization.previewRevision
        || !step || step.status !== 'running' || step.runId !== authorization.runId
        || step.callId !== authorization.callId || step.toolName !== authorization.toolName) {
      throw new Error('报工接续审批凭据与当前调用不一致');
    }
    const usedApproval = db.prepare(`SELECT id FROM erp_report_submissions
      WHERE batch_id = ? AND approval_id = ? LIMIT 1`)
      .get(id, authorization.approvalId) as { id?: unknown } | undefined;
    if (usedApproval) throw new Error('报工接续审批已使用，请重新预览并确认');
    return claimErpReportBatchInTransaction(id, claimKey, authorization.runId,
      ['partially_verified', 'cancelled', 'failed'], db, now);
  });
}

export interface InterruptedErpReportBatches {
  batches: number;
  unknownSubmissions: number;
  cancelledSubmissions: number;
}

/** A stopped process cannot know whether an in-flight browser request reached ERP. */
export function interruptErpReportBatch(
  id: string,
  expectedClaimKey: string | null = null,
  db: AppDatabase = getDatabase(),
  now = Date.now(),
): InterruptedErpReportBatches | null {
  return db.transaction(() => {
    const batch = getErpReportBatch(id, db);
    if (!batch || batch.executionStatus !== 'running'
        || (expectedClaimKey !== null && batch.activeClaimKey !== expectedClaimKey)) return null;
    const states = db.prepare(`SELECT state FROM erp_report_submissions WHERE batch_id = ?`)
      .all(id) as { state: ErpReportSubmissionState }[];
    const unknownSubmissions = states.filter((row) => row.state === 'dispatching' || row.state === 'verifying').length;
    const cancelledSubmissions = states.filter((row) => row.state === 'prepared').length;
    const hasUnknown = unknownSubmissions > 0 || states.some((row) => row.state === 'unknown');
    const hasVerified = states.some((row) => row.state === 'verified');
    const status: ErpReportBatchStatus = hasUnknown ? 'unknown' : hasVerified ? 'partially_verified' : 'cancelled';
    db.prepare(`UPDATE erp_report_submissions SET state = 'unknown', error_code = 'interrupted_after_dispatch', updated_at = ?
      WHERE batch_id = ? AND state IN ('dispatching', 'verifying')`).run(now, id);
    db.prepare(`UPDATE erp_report_submissions SET state = 'cancelled', error_code = 'interrupted_before_dispatch', updated_at = ?
      WHERE batch_id = ? AND state = 'prepared'`).run(now, id);
    db.prepare(`UPDATE erp_report_batches SET execution_status = ?, active_claim_key = NULL,
      claim_run_id = NULL, updated_at = ? WHERE id = ? AND execution_status = 'running'`)
      .run(status, now, id);
    const updated = getErpReportBatch(id, db);
    if (updated?.executionStatus !== status || updated.activeClaimKey !== null) {
      throw new Error('ERP 中断批次账本未能安全收口');
    }
    return { batches: 1, unknownSubmissions, cancelledSubmissions };
  });
}

export function recoverInterruptedErpReportBatches(
  db: AppDatabase = getDatabase(),
  now = Date.now(),
): InterruptedErpReportBatches {
  const running = db.prepare(`SELECT id FROM erp_report_batches WHERE execution_status = 'running'`)
    .all() as { id: string }[];
  const report = { batches: 0, unknownSubmissions: 0, cancelledSubmissions: 0 };
  for (const row of running) {
    const interrupted = interruptErpReportBatch(row.id, null, db, now);
    if (!interrupted) throw new Error('ERP 中断批次在恢复期间发生变化');
    report.batches += interrupted.batches;
    report.unknownSubmissions += interrupted.unknownSubmissions;
    report.cancelledSubmissions += interrupted.cancelledSubmissions;
  }
  return report;
}

export interface StartErpSubmissionInput {
  logicalOperationId: string;
  batchId: string;
  itemId: string;
  runId: string;
  stepId: string;
  callId: string;
  approvalId: string;
  request: unknown;
  beforeEntryIds: string[];
}

export function startErpSubmission(input: StartErpSubmissionInput, db: AppDatabase = getDatabase(), now = Date.now()): ErpReportSubmissionInfo {
  return db.transaction(() => {
    const live = db.prepare(`${SUBMISSION_SELECT} WHERE logical_operation_id = ? AND state IN ('prepared','dispatching','verifying','unknown','verified')`)
      .get(input.logicalOperationId) as unknown as ErpReportSubmissionRow | undefined;
    if (live) return submissionFromRow(live);
    const previous = db.prepare(`${SUBMISSION_SELECT} WHERE logical_operation_id = ? ORDER BY attempt_no DESC LIMIT 1`)
      .get(input.logicalOperationId) as unknown as ErpReportSubmissionRow | undefined;
    const id = uuidv4();
    const attemptNo = previous ? Number(previous.attempt_no) + 1 : 1;
    db.prepare(`INSERT INTO erp_report_submissions
      (id, logical_operation_id, batch_id, item_id, attempt_no, previous_attempt_id, run_id, step_id,
       call_id, approval_id, state, request_digest, before_entries_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?, ?, ?)`)
      .run(id, input.logicalOperationId, input.batchId, input.itemId, attemptNo, previous?.id ?? null,
        input.runId, input.stepId, input.callId, input.approvalId, digestErpPayload(input.request),
        canonicalJson(uniqueStrings(input.beforeEntryIds)), now, now);
    return getErpReportSubmission(id, db)!;
  });
}

export function getErpReportSubmission(id: string, db: AppDatabase = getDatabase()): ErpReportSubmissionInfo | null {
  const row = db.prepare(`${SUBMISSION_SELECT} WHERE id = ?`).get(id) as unknown as ErpReportSubmissionRow | undefined;
  return row ? submissionFromRow(row) : null;
}

export function listErpReportSubmissions(batchId: string, db: AppDatabase = getDatabase()): ErpReportSubmissionInfo[] {
  const rows = db.prepare(`${SUBMISSION_SELECT} WHERE batch_id = ? ORDER BY created_at, attempt_no`)
    .all(batchId) as unknown as ErpReportSubmissionRow[];
  return rows.map(submissionFromRow);
}

export function finishErpReportBatch(
  id: string,
  claimKey: string,
  status: Exclude<ErpReportBatchStatus, 'approved' | 'running'>,
  db: AppDatabase = getDatabase(),
  now = Date.now(),
): ErpReportBatchInfo | null {
  return db.transaction(() => {
    const current = getErpReportBatch(id, db);
    if (!current || current.activeClaimKey !== claimKey || current.executionStatus !== 'running') return null;
    db.prepare(`UPDATE erp_report_batches SET execution_status = ?, active_claim_key = NULL,
      claim_run_id = NULL, updated_at = ? WHERE id = ? AND execution_status = 'running' AND active_claim_key = ?`)
      .run(status, now, id, claimKey);
    const updated = getErpReportBatch(id, db);
    if (updated?.executionStatus === 'verified') {
      db.prepare(`UPDATE erp_report_drafts SET status = 'submitted', updated_at = ?
        WHERE id = ? AND revision = ? AND status = 'ready'`)
        .run(now, updated.draftId, updated.draftRevision);
    }
    return updated?.executionStatus === status ? updated : null;
  });
}

export function settleErpReportBatchAfterRecovery(
  id: string,
  status: 'verified' | 'partially_verified' | 'unknown',
  db: AppDatabase = getDatabase(),
  now = Date.now(),
): ErpReportBatchInfo | null {
  return db.transaction(() => {
    const current = getErpReportBatch(id, db);
    if (!current || current.activeClaimKey !== null || !['unknown', 'partially_verified', 'failed'].includes(current.executionStatus)) return null;
    db.prepare(`UPDATE erp_report_batches SET execution_status = ?, updated_at = ?
      WHERE id = ? AND active_claim_key IS NULL AND execution_status IN ('unknown','partially_verified','failed')`)
      .run(status, now, id);
    const updated = getErpReportBatch(id, db);
    if (updated?.executionStatus === 'verified') {
      db.prepare(`UPDATE erp_report_drafts SET status = 'submitted', updated_at = ?
        WHERE id = ? AND revision = ? AND status = 'ready'`).run(now, updated.draftId, updated.draftRevision);
    }
    return updated?.executionStatus === status ? updated : null;
  });
}

export function transitionErpSubmission(
  id: string,
  from: ErpReportSubmissionState,
  to: ErpReportSubmissionState,
  patch: { remoteTimeEntryId?: string | null; evidence?: Record<string, unknown> | null; errorCode?: string | null } = {},
  db: AppDatabase = getDatabase(),
  now = Date.now(),
): ErpReportSubmissionInfo | null {
  const current = getErpReportSubmission(id, db);
  if (!current || current.state !== from) return null;
  const errorCode = patch.errorCode === undefined
    ? current.errorCode
    : patch.errorCode?.trim().slice(0, MAX_ERROR_CODE_CHARS) || null;
  const sentAt = to === 'dispatching' ? now : current.sentAt;
  const remoteTimeEntryId = patch.remoteTimeEntryId === undefined ? current.remoteTimeEntryId : patch.remoteTimeEntryId;
  const evidence = patch.evidence === undefined ? current.evidence : patch.evidence;
  db.prepare(`UPDATE erp_report_submissions SET state = ?, remote_time_entry_id = ?, evidence_json = ?,
    error_code = ?, sent_at = ?, updated_at = ? WHERE id = ? AND state = ?`)
    .run(to, remoteTimeEntryId, evidence ? canonicalJson(evidence) : null,
      errorCode, sentAt, now, id, from);
  const updated = getErpReportSubmission(id, db);
  return updated?.state === to ? updated : null;
}
