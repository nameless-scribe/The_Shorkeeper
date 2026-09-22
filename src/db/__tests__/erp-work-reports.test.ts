import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type AppDatabase } from '../index';
import { openNativeDatabase } from '../native-adapter';
import {
  claimErpReportBatch,
  createErpReportDraft,
  freezeErpReportBatch,
  getErpReportSubmission,
  startErpSubmission,
  transitionErpSubmission,
  updateErpReportDraft,
} from '../repositories/erp-work-reports';
import type { ErpReportDraftItem } from '../../erp/contracts';
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
      expect(claimErpReportBatch(first.id, 'http://erp.test|7|2026-09-21', 'run-1', database, 300)).toBe(true);

      const secondDraft = createErpReportDraft({
        sessionId: 'session-2', connectionKey: 'erp-main', erpOrigin: 'http://erp.test', erpUserId: '7',
        workDate: '2026-09-21', items: [draftItem({ itemId: 'other' })],
      }, database);
      const second = freezeErpReportBatch({ ...input, draftId: secondDraft.id, approvalId: 'approval-2' }, database);
      expect(claimErpReportBatch(second.id, 'http://erp.test|7|2026-09-21', 'run-2', database)).toBe(false);
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
