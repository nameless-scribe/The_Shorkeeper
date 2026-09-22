import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, getDatabase, initDatabase } from '../../db';
import {
  createErpReportDraft,
  getErpReportDraft,
  listErpReportSubmissions,
} from '../../db/repositories/erp-work-reports';
import {
  createApproval,
  createTaskRun,
  decideApproval,
  startTaskRunStep,
} from '../../db/repositories/task-runs';
import { digestErpPayload, type ErpReportDraftItem } from '../contracts';
import type { ErpReadContext, ErpTimeEntrySummary } from '../read-client';
import { setErpRuntime, type ErpSubmitDispatchResult, type ErpTimeEntryInput } from '../runtime';
import { executeErpSubmission, previewErpSubmission, reconcileErpSubmission } from '../submission-service';

describe('ERP submission service', () => {
  let tempDir = '';
  let entries: ErpTimeEntrySummary[] = [];
  let dispatches: ErpTimeEntryInput[] = [];
  let dispatchResult: ErpSubmitDispatchResult = { status: 'accepted' };

  const tasks = [
    { taskId: '1001', taskName: 'APS 调整', projectName: '日常', ownerId: '7', ownerName: '苏运来', actualMinutes: 0 },
    { taskId: '1002', taskName: '采购优化', projectName: '订单系统', ownerId: '7', ownerName: '苏运来', actualMinutes: 0 },
  ];

  function context(): ErpReadContext {
    return {
      identity: { userId: '7', userName: '苏运来' },
      tasks,
      entries: entries.map((entry) => ({ ...entry })),
      existingMinutes: entries.reduce((total, entry) => total + entry.workMinutes, 0),
    };
  }

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-erp-submit-'));
    await initDatabase(path.join(tempDir, 'submit.db'));
    entries = [];
    dispatches = [];
    dispatchResult = { status: 'accepted' };
    setErpRuntime({
      connect: async () => ({ state: 'authenticated', origin: 'http://erp.test', browserChannel: 'msedge', pageUrl: 'http://erp.test/taskboard/index', userId: '7', userName: '苏运来', message: '已登录' }),
      status: () => ({ state: 'authenticated', origin: 'http://erp.test', browserChannel: 'msedge', pageUrl: 'http://erp.test/taskboard/index', userId: '7', userName: '苏运来', message: '已登录' }),
      readContext: async () => context(),
      submitTimeEntry: async (input) => {
        dispatches.push(input);
        if (dispatchResult.status !== 'known_not_written') {
          entries.push({
            timeEntryId: String(100 + entries.length), taskId: input.taskId, ownerId: '7', workDate: input.workDate,
            workMinutes: input.workMinutes, workContent: input.workContent, createBy: '苏运来',
          });
        }
        return dispatchResult;
      },
    });
  });

  afterEach(() => {
    setErpRuntime(null);
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function item(itemId: string, taskId: string, taskName: string, minutes: number): ErpReportDraftItem {
    return { itemId, taskId, taskName, projectName: taskId === '1001' ? '日常' : '订单系统', workMinutes: minutes,
      workContent: `${taskName}工作内容`, durationEstimated: false, sourceMessageIds: ['message-1'] };
  }

  async function arrange(items = [item('i1', '1001', 'APS 调整', 60)]) {
    const draft = createErpReportDraft({
      sessionId: 'session-1', connectionKey: 'connection-1', erpOrigin: 'http://erp.test', erpUserId: '7',
      workDate: '2026-09-21', items,
    });
    const request = { draftId: draft.id, draftRevision: 1, allowPossibleDuplicate: false };
    const preview = await previewErpSubmission(request, 'session-1');
    const rawArgs = { draft_id: draft.id, draft_revision: 1 };
    createTaskRun({ id: 'run-1', sessionId: 'session-1' });
    startTaskRunStep({ runId: 'run-1', callId: 'call-1', toolName: 'submit_erp_report', riskLevel: 'high' });
    const approval = createApproval({
      runId: 'run-1', sessionId: 'session-1', callId: 'call-1', toolName: 'submit_erp_report',
      args: rawArgs, argsDigest: digestErpPayload(rawArgs), previewRevision: preview.revision, riskLevel: 'high',
    });
    decideApproval(approval.id, 'approved', 'user');
    return { draft, request, preview, approval, argsDigest: digestErpPayload(rawArgs) };
  }

  it('submits serially and only succeeds after each new ERP record is uniquely read back', async () => {
    const setup = await arrange([item('i1', '1001', 'APS 调整', 60), item('i2', '1002', '采购优化', 120)]);
    const result = await executeErpSubmission(setup.request, {
      sessionId: 'session-1', runId: 'run-1', stepId: 'run-1:call-1', callId: 'call-1',
      approvalId: setup.approval.id, argsDigest: setup.argsDigest, previewRevision: setup.preview.revision,
      toolName: 'submit_erp_report', signal: new AbortController().signal,
    });

    expect(result).toMatchObject({ verified: 2, total: 2 });
    expect(dispatches.map((entry) => entry.taskId)).toEqual(['1001', '1002']);
    expect(listErpReportSubmissions(result.batchId).map((row) => row.state)).toEqual(['verified', 'verified']);
    expect(getErpReportDraft(setup.draft.id)?.status).toBe('submitted');
  });

  it('rejects an expired preview before any ERP write', async () => {
    const setup = await arrange();
    entries.push({ timeEntryId: 'external', taskId: '1002', ownerId: '7', workDate: '2026-09-21', workMinutes: 30, workContent: '其他工作', createBy: '苏运来' });
    await expect(executeErpSubmission(setup.request, {
      sessionId: 'session-1', runId: 'run-1', stepId: 'run-1:call-1', callId: 'call-1',
      approvalId: setup.approval.id, argsDigest: setup.argsDigest, previewRevision: setup.preview.revision,
      toolName: 'submit_erp_report', signal: new AbortController().signal,
    })).rejects.toThrow('预览已失效');
    expect(dispatches).toEqual([]);
  });

  it('records outcome_unknown and stops when the click may have written despite a lost response', async () => {
    const setup = await arrange();
    dispatchResult = { status: 'outcome_unknown', message: '响应超时' };
    await expect(executeErpSubmission(setup.request, {
      sessionId: 'session-1', runId: 'run-1', stepId: 'run-1:call-1', callId: 'call-1',
      approvalId: setup.approval.id, argsDigest: setup.argsDigest, previewRevision: setup.preview.revision,
      toolName: 'submit_erp_report', signal: new AbortController().signal,
    })).rejects.toThrow('结果未知');
    expect(dispatches).toHaveLength(1);
    const batchRow = getDatabase().prepare('SELECT id FROM erp_report_batches LIMIT 1').get() as { id: string };
    const row = listErpReportSubmissions(batchRow.id)[0];
    expect(row.state).toBe('unknown');
    const recovered = await reconcileErpSubmission(batchRow.id, 'session-1');
    expect(recovered).toMatchObject({ recovered: 1, unresolved: 0, verified: 1, total: 1 });
    expect(listErpReportSubmissions(batchRow.id)[0].state).toBe('verified');
    expect(getErpReportDraft(setup.draft.id)?.status).toBe('submitted');
  });
});
