import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type AppDatabase } from '../index';
import { openNativeDatabase } from '../native-adapter';
import {
  claimErpReportBatch,
  claimErpReportBatchForResume,
  createErpReportDraft,
  finishErpReportBatch,
  freezeErpReportBatch,
  getErpReportBatch,
  getErpReportSubmission,
  listErpRunReports,
  recoverInterruptedErpReportBatches,
  settleErpReportBatchAfterRecovery,
  startErpSubmission,
  transitionErpSubmission,
  updateErpReportDraft,
} from '../repositories/erp-work-reports';
import type { ErpReportDraftItem } from '../../erp/contracts';
import { digestErpPayload } from '../../erp/contracts';
import { createApproval, createTaskRun, decideApproval, startTaskRunStep } from '../repositories/task-runs';

interface ContractDatabase extends AppDatabase { close(): void }

const adapters = [
  { name: 'sql.js', open: (dbPath: string) => openDatabase(dbPath) },
  { name: 'better-sqlite3', open: async (dbPath: string) => openNativeDatabase(dbPath) },
] as const;

function draftItem(overrides: Partial<ErpReportDraftItem> = {}): ErpReportDraftItem {
  return {
    itemId: 'item-aps', taskId: '1001', taskName: 'APS 自动排产系统调整',
    projectName: '光拓智能日常', workMinutes: 210, workContent: '调整排产算法，修复扫描问题。',
    durationEstimated: false, sourceMessageIds: ['message-1'], ...overrides,
  };
}

for (const adapter of adapters) {
  describe(`ERP report ledger (${adapter.name})`, () => {
    let tempDir = '';
    let db: ContractDatabase | undefined;

    afterEach(() => {
      db?.close(); db = undefined;
      if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    });

    async function open(): Promise<ContractDatabase> {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `sk-erp-ledger-${adapter.name}-`));
      db = await adapter.open(path.join(tempDir, 'erp.db'));
      return db;
    }

    it('persists a draft and rejects a stale revision update', async () => {
      const database = await open();
      const draft = createErpReportDraft({
        sessionId: 'session-1', connectionKey: 'erp-main', erpOrigin: 'http://49.7.10.65:9024/login',
        erpUserId: '7', workDate: '2026-09-21', items: [draftItem()],
      }, database, 100);
      expect(draft).toMatchObject({ revision: 1, status: 'ready', erpOrigin: 'http://49.7.10.65:9024' });

      const updated = updateErpReportDraft(draft.id, 1, {
        items: [draftItem({ workMinutes: 240 })], sourceMessageIds: ['message-1', 'message-2'],
      }, database, 200);
      expect(updated).toMatchObject({ revision: 2, status: 'ready' });
      expect(updated?.items[0].workMinutes).toBe(240);
      expect(updateErpReportDraft(draft.id, 1, { items: [draftItem()] }, database, 300)).toBeNull();
    });

    it('freezes exactly one immutable batch for a draft revision and claims a date once', async () => {
      const database = await open();
      const draft = createErpReportDraft({
        sessionId: 'session-1', connectionKey: 'erp-main', erpOrigin: 'http://erp.test', erpUserId: '7',
        workDate: '2026-09-21', items: [draftItem()],
      }, database);
      const input = { draftId: draft.id, draftRevision: 1, previewRevision: 'preview-1', approvalId: 'approval-1', authorizedRunId: 'run-1' };
      const first = freezeErpReportBatch(input, database, 100);
      const replay = freezeErpReportBatch(input, database, 200);
      expect(replay.id).toBe(first.id);
      expect(replay.payloadDigest).toBe(first.payloadDigest);
      expect(claimErpReportBatch(first.id, 'wrong-connection|7|2026-09-21', 'run-1', database)).toBe(false);
      expect(claimErpReportBatch(first.id, 'erp-main|7|2026-09-21', 'run-1', database, 300)).toBe(true);
      expect(claimErpReportBatch(first.id, 'erp-main|7|2026-09-21', 'run-1', database, 301)).toBe(false);

      const secondDraft = createErpReportDraft({
        sessionId: 'session-2', connectionKey: 'erp-main', erpOrigin: 'http://erp.test', erpUserId: '7',
        workDate: '2026-09-21', items: [draftItem({ itemId: 'other' })],
      }, database);
      const second = freezeErpReportBatch({ ...input, draftId: secondDraft.id, approvalId: 'approval-2' }, database);
      expect(claimErpReportBatch(second.id, 'erp-main|7|2026-09-21', 'run-2', database)).toBe(false);

      const nextDayDraft = createErpReportDraft({
        sessionId: 'session-3', connectionKey: 'erp-main', erpOrigin: 'http://erp.test', erpUserId: '7',
        workDate: '2026-09-22', items: [draftItem({ itemId: 'next-day' })],
      }, database);
      const nextDay = freezeErpReportBatch({ ...input, draftId: nextDayDraft.id, approvalId: 'approval-3' }, database);
      expect(claimErpReportBatch(nextDay.id, 'erp-main|7|2026-09-22', 'run-3', database)).toBe(false);
      expect(finishErpReportBatch(first.id, 'erp-main|7|2026-09-21', 'cancelled', database)).not.toBeNull();
      expect(claimErpReportBatch(nextDay.id, 'erp-main|7|2026-09-22', 'run-3', database)).toBe(true);
    });

    it('turns interrupted sends into unknown and blocks another batch for the same day', async () => {
      const database = await open();
      const firstDraft = createErpReportDraft({
        sessionId: 'session-1', connectionKey: 'erp-main', erpOrigin: 'http://erp.test', erpUserId: '7',
        workDate: '2026-09-21', items: [draftItem()],
      }, database);
      const first = freezeErpReportBatch({
        draftId: firstDraft.id, draftRevision: 1, previewRevision: 'preview-1', approvalId: 'approval-1', authorizedRunId: 'run-1',
      }, database);
      const claimKey = 'erp-main|7|2026-09-21';
      expect(claimErpReportBatch(first.id, claimKey, 'run-1', database)).toBe(true);
      const submission = startErpSubmission({
        logicalOperationId: `${first.id}:item-aps`, batchId: first.id, itemId: 'item-aps', runId: 'run-1',
        stepId: 'step-1', callId: 'call-1', approvalId: 'approval-1', request: { taskId: '1001' }, beforeEntryIds: [],
      }, database);
      transitionErpSubmission(submission.id, 'prepared', 'dispatching', {}, database);

      const secondDraft = createErpReportDraft({
        sessionId: 'session-2', connectionKey: 'erp-main', erpOrigin: 'http://erp.test', erpUserId: '7',
        workDate: '2026-09-21', items: [draftItem({ itemId: 'other' })],
      }, database);
      const second = freezeErpReportBatch({
        draftId: secondDraft.id, draftRevision: 1, previewRevision: 'preview-2', approvalId: 'approval-2', authorizedRunId: 'run-2',
      }, database);

      expect(recoverInterruptedErpReportBatches(database)).toEqual({ batches: 1, unknownSubmissions: 1, cancelledSubmissions: 0 });
      expect(recoverInterruptedErpReportBatches(database)).toEqual({ batches: 0, unknownSubmissions: 0, cancelledSubmissions: 0 });
      expect(getErpReportBatch(first.id, database)).toMatchObject({ executionStatus: 'unknown', activeClaimKey: null });
      expect(getErpReportSubmission(submission.id, database)?.state).toBe('unknown');
      expect(claimErpReportBatch(second.id, claimKey, 'run-2', database)).toBe(false);

      transitionErpSubmission(submission.id, 'unknown', 'verified', { remoteTimeEntryId: 'remote-1' }, database);
      settleErpReportBatchAfterRecovery(first.id, 'verified', database);
      expect(claimErpReportBatch(second.id, claimKey, 'run-2', database)).toBe(true);
    });

    it('cancels an interrupted prepared item while preserving an already verified item', async () => {
      const database = await open();
      const draft = createErpReportDraft({
        sessionId: 'session-1', connectionKey: 'erp-main', erpOrigin: 'http://erp.test', erpUserId: '7',
        workDate: '2026-09-21', items: [draftItem(), draftItem({ itemId: 'item-2' })],
      }, database);
      const batch = freezeErpReportBatch({
        draftId: draft.id, draftRevision: 1, previewRevision: 'preview-1', approvalId: 'approval-1', authorizedRunId: 'run-1',
      }, database);
      expect(claimErpReportBatch(batch.id, 'erp-main|7|2026-09-21', 'run-1', database)).toBe(true);
      const base = { batchId: batch.id, runId: 'run-1', stepId: 'step-1', callId: 'call-1', approvalId: 'approval-1',
        request: { taskId: '1001' }, beforeEntryIds: [] };
      const verified = startErpSubmission({ ...base, itemId: 'item-aps', logicalOperationId: `${batch.id}:item-aps` }, database);
      transitionErpSubmission(verified.id, 'prepared', 'dispatching', {}, database);
      transitionErpSubmission(verified.id, 'dispatching', 'verifying', {}, database);
      transitionErpSubmission(verified.id, 'verifying', 'verified', { remoteTimeEntryId: 'remote-1' }, database);
      const prepared = startErpSubmission({ ...base, itemId: 'item-2', logicalOperationId: `${batch.id}:item-2` }, database);

      expect(recoverInterruptedErpReportBatches(database)).toEqual({ batches: 1, unknownSubmissions: 0, cancelledSubmissions: 1 });
      expect(getErpReportBatch(batch.id, database)).toMatchObject({ executionStatus: 'partially_verified', activeClaimKey: null });
      expect(getErpReportSubmission(verified.id, database)?.state).toBe('verified');
      expect(getErpReportSubmission(prepared.id, database)?.state).toBe('cancelled');
    });

    it('requires a fresh bound approval before claiming the remaining items of a partial batch', async () => {
      const database = await open();
      const draft = createErpReportDraft({
        sessionId: 'session-1', connectionKey: 'erp-main', erpOrigin: 'http://erp.test', erpUserId: '7',
        workDate: '2026-09-21', items: [draftItem(), draftItem({ itemId: 'item-2' })],
      }, database);
      const batch = freezeErpReportBatch({
        draftId: draft.id, draftRevision: 1, previewRevision: 'first-preview', approvalId: 'first-approval', authorizedRunId: 'run-1',
      }, database);
      const claimKey = 'erp-main|7|2026-09-21';
      expect(claimErpReportBatch(batch.id, claimKey, 'run-1', database)).toBe(true);
      const first = startErpSubmission({
        logicalOperationId: `${batch.id}:item-aps`, batchId: batch.id, itemId: 'item-aps', runId: 'run-1',
        stepId: 'step-1', callId: 'call-1', approvalId: 'first-approval', request: { taskId: '1001' }, beforeEntryIds: [],
      }, database);
      transitionErpSubmission(first.id, 'prepared', 'dispatching', {}, database);
      transitionErpSubmission(first.id, 'dispatching', 'verifying', {}, database);
      transitionErpSubmission(first.id, 'verifying', 'verified', { remoteTimeEntryId: 'remote-1' }, database);
      finishErpReportBatch(batch.id, claimKey, 'partially_verified', database);
      expect(claimErpReportBatch(batch.id, claimKey, 'run-1', database)).toBe(false);

      createTaskRun({ id: 'run-2', sessionId: 'session-1' }, database);
      startTaskRunStep({ runId: 'run-2', callId: 'call-2', toolName: 'submit_erp_report', riskLevel: 'high' }, database);
      const args = { batch_id: batch.id };
      const approval = createApproval({
        runId: 'run-2', sessionId: 'session-1', callId: 'call-2', toolName: 'submit_erp_report',
        args, argsDigest: digestErpPayload(args), previewRevision: 'resume-preview', riskLevel: 'high',
      }, database);
      decideApproval(approval.id, 'approved', 'user', database);
      const authorization = {
        sessionId: 'session-1', runId: 'run-2', callId: 'call-2', toolName: 'submit_erp_report',
        approvalId: approval.id, argsDigest: digestErpPayload(args), previewRevision: 'resume-preview',
      };
      expect(() => claimErpReportBatchForResume(batch.id, claimKey, { ...authorization, argsDigest: 'wrong' }, database)).toThrow('审批凭据');
      expect(claimErpReportBatchForResume(batch.id, claimKey, authorization, database)).toBe(true);
      expect(claimErpReportBatchForResume(batch.id, claimKey, authorization, database)).toBe(false);
      const resumed = startErpSubmission({
        logicalOperationId: `${batch.id}:item-2`, batchId: batch.id, itemId: 'item-2', runId: 'run-2',
        stepId: 'step-2', callId: 'call-2', approvalId: approval.id,
        request: { taskId: '1001' }, beforeEntryIds: ['remote-1'],
      }, database);
      transitionErpSubmission(resumed.id, 'prepared', 'cancelled', {}, database);
      finishErpReportBatch(batch.id, claimKey, 'partially_verified', database);
      expect(() => claimErpReportBatchForResume(batch.id, claimKey, authorization, database))
        .toThrow('审批已使用');
      expect(listErpRunReports('run-1', database)).toMatchObject([{
        batchId: batch.id, status: 'partially_verified', workDate: '2026-09-21',
        items: [
          { itemId: 'item-aps', state: 'verified', attemptedInRun: true, remoteTimeEntryId: 'remote-1' },
          { itemId: 'item-2', state: 'cancelled', attemptedInRun: false },
        ],
      }]);
      expect(listErpRunReports('run-2', database)).toMatchObject([{
        batchId: batch.id, items: [
          { itemId: 'item-aps', attemptedInRun: false },
          { itemId: 'item-2', attemptedInRun: true },
        ],
      }]);
      expect(listErpRunReports('another-run', database)).toEqual([]);
    });

    it('freezes with a strict approval only when run, call, args and preview bindings match', async () => {
      const database = await open();
      createTaskRun({ id: 'run-auth', sessionId: 'session-auth' }, database);
      startTaskRunStep({ runId: 'run-auth', callId: 'call-auth', toolName: 'submit_erp_report', riskLevel: 'high' }, database);
      const approval = createApproval({
        runId: 'run-auth', sessionId: 'session-auth', callId: 'call-auth', toolName: 'submit_erp_report',
        args: { draft_id: 'pending' }, argsDigest: 'args-digest', previewRevision: 'preview-auth', riskLevel: 'high',
      }, database);
      decideApproval(approval.id, 'approved', 'user', database);
      const draft = createErpReportDraft({
        sessionId: 'session-auth', connectionKey: 'erp-main', erpOrigin: 'http://erp.test', erpUserId: '7',
        workDate: '2026-09-21', items: [draftItem()],
      }, database);
      expect(() => freezeErpReportBatch({
        draftId: draft.id, draftRevision: 1, previewRevision: 'preview-auth', approvalId: approval.id, authorizedRunId: 'run-auth',
        authorization: { sessionId: 'session-auth', callId: 'call-auth', argsDigest: 'wrong', toolName: 'submit_erp_report' },
      }, database)).toThrow('审批凭据');
      expect(freezeErpReportBatch({
        draftId: draft.id, draftRevision: 1, previewRevision: 'preview-auth', approvalId: approval.id, authorizedRunId: 'run-auth',
        authorization: { sessionId: 'session-auth', callId: 'call-auth', argsDigest: 'args-digest', toolName: 'submit_erp_report' },
      }, database)).toMatchObject({ approvalId: approval.id, authorizedRunId: 'run-auth' });
    });

    it('reuses a live logical operation and rejects stale state transitions', async () => {
      const database = await open();
      const draft = createErpReportDraft({
        sessionId: 'session-1', connectionKey: 'erp-main', erpOrigin: 'http://erp.test', erpUserId: '7',
        workDate: '2026-09-21', items: [draftItem()],
      }, database);
      const batch = freezeErpReportBatch({
        draftId: draft.id, draftRevision: 1, previewRevision: 'preview-1', approvalId: 'approval-1', authorizedRunId: 'run-1',
      }, database);
      const input = {
        logicalOperationId: `${batch.id}:item-aps`, batchId: batch.id, itemId: 'item-aps', runId: 'run-1',
        stepId: 'step-1', callId: 'call-1', approvalId: 'approval-1', request: { taskId: '1001', workHour: 3.5 },
        beforeEntryIds: ['entry-old'],
      };
      const first = startErpSubmission(input, database, 100);
      expect(startErpSubmission(input, database, 200).id).toBe(first.id);
      expect(transitionErpSubmission(first.id, 'prepared', 'dispatching', {}, database, 300)).toMatchObject({ state: 'dispatching', sentAt: 300 });
      expect(transitionErpSubmission(first.id, 'prepared', 'cancelled', {}, database, 400)).toBeNull();
      expect(transitionErpSubmission(first.id, 'dispatching', 'verifying', {}, database, 500)?.sentAt).toBe(300);
      expect(transitionErpSubmission(first.id, 'verifying', 'verified', {
        remoteTimeEntryId: 'entry-new', evidence: { matched: true },
      }, database, 600)).toMatchObject({ state: 'verified', remoteTimeEntryId: 'entry-new' });
      expect(getErpReportSubmission(first.id, database)?.evidence).toEqual({ matched: true });
      expect(startErpSubmission(input, database, 700).id).toBe(first.id);
    });

    it('only allows a retry after the previous attempt is proven not written', async () => {
      const database = await open();
      const draft = createErpReportDraft({
        sessionId: 'session-1', connectionKey: 'erp-main', erpOrigin: 'http://erp.test', erpUserId: '7',
        workDate: '2026-09-21', items: [draftItem()],
      }, database);
      const batch = freezeErpReportBatch({
        draftId: draft.id, draftRevision: 1, previewRevision: 'preview-1', approvalId: 'approval-1', authorizedRunId: 'run-1',
      }, database);
      const base = {
        logicalOperationId: `${batch.id}:item-aps`, batchId: batch.id, itemId: 'item-aps', runId: 'run-1',
        stepId: 'step-1', callId: 'call-1', approvalId: 'approval-1', request: { taskId: '1001' }, beforeEntryIds: [],
      };
      const first = startErpSubmission(base, database);
      transitionErpSubmission(first.id, 'prepared', 'known_not_written', { errorCode: 'rejected' }, database);
      const retry = startErpSubmission({ ...base, runId: 'run-2', stepId: 'step-2', callId: 'call-2', approvalId: 'approval-2' }, database);
      expect(retry.id).not.toBe(first.id);
      expect(retry).toMatchObject({ attemptNo: 2, previousAttemptId: first.id, state: 'prepared' });
    });
  });
}
