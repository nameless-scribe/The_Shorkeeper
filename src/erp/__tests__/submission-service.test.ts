import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDatabase, getDatabase, initDatabase } from '../../db';
import {
  createErpReportDraft,
  getErpReportDraft,
  listErpReportSubmissions,
  updateErpReportDraft,
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
  let throwAfterWrite = false;
  let abortAfterFirstWrite: AbortController | null = null;
  let readCount = 0;
  let injectExternalOnRead = 0;
  let activeOrigin = 'http://erp.test';

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
    throwAfterWrite = false;
    abortAfterFirstWrite = null;
    readCount = 0;
    injectExternalOnRead = 0;
    activeOrigin = 'http://erp.test';
    setErpRuntime({
      connect: async () => ({ state: 'authenticated', origin: 'http://erp.test', browserChannel: 'msedge', pageUrl: 'http://erp.test/taskboard/index', userId: '7', userName: '苏运来', message: '已登录' }),
      status: () => ({ state: 'authenticated', origin: activeOrigin, browserChannel: 'msedge', pageUrl: `${activeOrigin}/taskboard/index`, userId: '7', userName: '苏运来', message: '已登录' }),
      readContext: async () => {
        readCount += 1;
        if (readCount === injectExternalOnRead) {
          entries.push({ timeEntryId: 'external-race', taskId: '1002', ownerId: '7', workDate: '2026-09-21',
            workMinutes: 30, workContent: '并发新增', createBy: '苏运来' });
        }
        return context();
      },
      submitTimeEntry: async (input) => {
        dispatches.push(input);
        if (dispatchResult.status !== 'known_not_written') {
          entries.push({
            timeEntryId: String(100 + entries.length), taskId: input.taskId, ownerId: '7', workDate: input.workDate,
            workMinutes: input.workMinutes, workContent: input.workContent, createBy: '苏运来',
          });
        }
        if (throwAfterWrite) throw new Error('浏览器连接中断');
        if (dispatches.length === 1) abortAfterFirstWrite?.abort();
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

  it('rejects an old-site draft before preview or write after the ERP connection changes', async () => {
    const setup = await arrange();
    activeOrigin = 'http://another-erp.test';
    await expect(previewErpSubmission(setup.request, 'session-1')).rejects.toThrow('站点');
    await expect(executeErpSubmission(setup.request, {
      sessionId: 'session-1', runId: 'run-1', stepId: 'run-1:call-1', callId: 'call-1',
      approvalId: setup.approval.id, argsDigest: setup.argsDigest, previewRevision: setup.preview.revision,
      toolName: 'submit_erp_report', signal: new AbortController().signal,
    })).rejects.toThrow('站点');
    expect(dispatches).toHaveLength(0);
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

  it('stops before clicking when the remote day changes after approval validation', async () => {
    const setup = await arrange();
    injectExternalOnRead = readCount + 2;
    await expect(executeErpSubmission(setup.request, {
      sessionId: 'session-1', runId: 'run-1', stepId: 'run-1:call-1', callId: 'call-1',
      approvalId: setup.approval.id, argsDigest: setup.argsDigest, previewRevision: setup.preview.revision,
      toolName: 'submit_erp_report', signal: new AbortController().signal,
    })).rejects.toThrow('当天报工记录在确认后发生变化');
    expect(dispatches).toHaveLength(0);
  });

  it('does not click when persisting the dispatching state fails', async () => {
    const setup = await arrange();
    const database = getDatabase();
    const realPrepare = database.prepare.bind(database);
    const spy = vi.spyOn(database, 'prepare').mockImplementation((sql) => {
      const statement = realPrepare(sql);
      if (!sql.startsWith('UPDATE erp_report_submissions SET state = ?')) return statement;
      return {
        all: (...args) => statement.all(...args),
        get: (...args) => statement.get(...args),
        run: (...args) => { if (args[0] !== 'dispatching') statement.run(...args); },
      };
    });
    try {
      await expect(executeErpSubmission(setup.request, {
        sessionId: 'session-1', runId: 'run-1', stepId: 'run-1:call-1', callId: 'call-1',
        approvalId: setup.approval.id, argsDigest: setup.argsDigest, previewRevision: setup.preview.revision,
        toolName: 'submit_erp_report', signal: new AbortController().signal,
      })).rejects.toThrow('发送账本未能可靠记录');
    } finally { spy.mockRestore(); }
    expect(dispatches).toHaveLength(0);
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
    await expect(previewErpSubmission({ batchId: batchRow.id, allowPossibleDuplicate: false }, 'session-1'))
      .rejects.toThrow('不能接续');
    expect(updateErpReportDraft(setup.draft.id, 1, {
      erpUserId: 'another-user',
      items: [{ ...item('i1', '1001', 'APS 调整', 60), workContent: '后来修订的内容' }],
    })).toMatchObject({ revision: 2 });
    const recovered = await reconcileErpSubmission(batchRow.id, 'session-1');
    expect(recovered).toMatchObject({ recovered: 1, unresolved: 0, verified: 1, total: 1 });
    expect(listErpReportSubmissions(batchRow.id)[0].state).toBe('verified');
    expect(getErpReportDraft(setup.draft.id)).toMatchObject({ revision: 2, status: 'ready' });
  });

  it('releases the local claim as unknown when the browser throws after a possible write', async () => {
    const setup = await arrange();
    throwAfterWrite = true;
    await expect(executeErpSubmission(setup.request, {
      sessionId: 'session-1', runId: 'run-1', stepId: 'run-1:call-1', callId: 'call-1',
      approvalId: setup.approval.id, argsDigest: setup.argsDigest, previewRevision: setup.preview.revision,
      toolName: 'submit_erp_report', signal: new AbortController().signal,
    })).rejects.toThrow('结果未知');
    expect(dispatches).toHaveLength(1);
    const batchRow = getDatabase().prepare('SELECT id FROM erp_report_batches LIMIT 1').get() as { id: string };
    expect(listErpReportSubmissions(batchRow.id)[0].state).toBe('unknown');
    expect(await reconcileErpSubmission(batchRow.id, 'session-1')).toMatchObject({ recovered: 1, unresolved: 0 });
  });

  it('previews only remaining work and resumes a partial batch with a new approval', async () => {
    const setup = await arrange([item('i1', '1001', 'APS 调整', 60), item('i2', '1002', '采购优化', 120)]);
    const firstSignal = new AbortController();
    abortAfterFirstWrite = firstSignal;
    await expect(executeErpSubmission(setup.request, {
      sessionId: 'session-1', runId: 'run-1', stepId: 'run-1:call-1', callId: 'call-1',
      approvalId: setup.approval.id, argsDigest: setup.argsDigest, previewRevision: setup.preview.revision,
      toolName: 'submit_erp_report', signal: firstSignal.signal,
    })).rejects.toThrow('取消');
    const batchRow = getDatabase().prepare('SELECT id FROM erp_report_batches LIMIT 1').get() as { id: string };
    expect(listErpReportSubmissions(batchRow.id).map((row) => row.state)).toEqual(['verified', 'cancelled']);
    expect(dispatches.map((entry) => entry.taskId)).toEqual(['1001']);

    const request = { batchId: batchRow.id, allowPossibleDuplicate: false };
    const preview = await previewErpSubmission(request, 'session-1');
    expect(preview.erpWorkReport).toMatchObject({ existingMinutes: 60, batchMinutes: 120 });
    expect(preview.erpWorkReport?.items.map((entry) => entry.itemId)).toEqual(['i2']);

    const rawArgs = { batch_id: batchRow.id };
    createTaskRun({ id: 'run-2', sessionId: 'session-1' });
    startTaskRunStep({ runId: 'run-2', callId: 'call-2', toolName: 'submit_erp_report', riskLevel: 'high' });
    const approval = createApproval({
      runId: 'run-2', sessionId: 'session-1', callId: 'call-2', toolName: 'submit_erp_report',
      args: rawArgs, argsDigest: digestErpPayload(rawArgs), previewRevision: preview.revision, riskLevel: 'high',
    });
    decideApproval(approval.id, 'approved', 'user');
    abortAfterFirstWrite = null;
    const resumeAuthorization = {
      sessionId: 'session-1', runId: 'run-2', stepId: 'run-2:call-2', callId: 'call-2',
      approvalId: approval.id, argsDigest: digestErpPayload(rawArgs), previewRevision: preview.revision,
      toolName: 'submit_erp_report', signal: new AbortController().signal,
    };
    entries.push({ timeEntryId: 'external-change', taskId: '1001', ownerId: '7', workDate: '2026-09-21',
      workMinutes: 30, workContent: '其他工作', createBy: '苏运来' });
    await expect(executeErpSubmission(request, resumeAuthorization)).rejects.toThrow('旧预览已失效');
    expect(dispatches).toHaveLength(1);
    entries.pop();
    const resumed = await executeErpSubmission(request, resumeAuthorization);
    expect(resumed).toMatchObject({ batchId: batchRow.id, verified: 2, total: 2 });
    expect(dispatches.map((entry) => entry.taskId)).toEqual(['1001', '1002']);
    expect(listErpReportSubmissions(batchRow.id).map((row) => row.state)).toEqual(['verified', 'cancelled', 'verified']);
    expect(getErpReportDraft(setup.draft.id)?.status).toBe('submitted');
  });
});
