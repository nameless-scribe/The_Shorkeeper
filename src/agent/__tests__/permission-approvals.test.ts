import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ ready: true }));

vi.mock('../../db/state', () => ({
  isDatabaseReady: () => state.ready,
}));

import { closeDatabase, initDatabase } from '../../db';
import { createTaskRun, listApprovals, startTaskRunStep } from '../../db/repositories/task-runs';
import type { ToolDefinition } from '../../tools/types';
import { checkPermission, confirmPermission, confirmPermissionStrict, digestPermissionArgs, setPermissionConfirmer } from '../permissions';

describe('permission approvals', () => {
  let tempDir: string;

  beforeEach(async () => {
    state.ready = true;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-approvals-'));
    await initDatabase(path.join(tempDir, 'approvals.db'));
    createTaskRun({ id: 'run-1', sessionId: 'session-1' });
  });

  afterEach(() => {
    setPermissionConfirmer(async () => false);
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('records the request and the user decision with the tool risk', async () => {
    let receivedContext: unknown;
    setPermissionConfirmer(async (_tool, _args, _signal, context) => {
      receivedContext = context;
      return true;
    });

    const approved = await confirmPermission('write_file', { path: 'a.md', content: 'x'.repeat(5_000) }, undefined, {
      runId: 'run-1',
      sessionId: 'session-1',
      risk: 'medium',
    });

    expect(approved).toBe(true);
    expect(receivedContext).toEqual({ runId: 'run-1', sessionId: 'session-1', risk: 'medium' });
    const [approval] = listApprovals({ runId: 'run-1' });
    expect(approval).toMatchObject({
      toolName: 'write_file',
      riskLevel: 'medium',
      status: 'approved',
      decidedBy: 'user',
      sessionId: 'session-1',
    });
    expect(approval.argsSummary.length).toBeLessThanOrEqual(2_001);
    expect(approval.decidedAt).not.toBeNull();
  });

  it('maps timeout, abort and window-close outcomes to distinct approval states', async () => {
    setPermissionConfirmer(async () => ({ approved: false, decidedBy: 'timeout' }));
    expect(await confirmPermission('gen_pdf', {}, undefined, { runId: 'run-1' })).toBe(false);
    setPermissionConfirmer(async () => ({ approved: false, decidedBy: 'window_closed' }));
    expect(await confirmPermission('gen_pdf', {}, undefined, { runId: 'run-1' })).toBe(false);
    const controller = new AbortController();
    setPermissionConfirmer(async (_t, _a, signal) => {
      controller.abort();
      return signal?.aborted ? false : true;
    });
    expect(await confirmPermission('gen_pdf', {}, controller.signal, { runId: 'run-1' })).toBe(false);

    const statuses = listApprovals({ runId: 'run-1' })
      .map((approval) => `${approval.status}/${approval.decidedBy}`)
      .sort();
    expect(statuses).toEqual(['cancelled/abort', 'cancelled/window_closed', 'expired/timeout']);
  });

  it('records a confirmer failure as an error decision, not as a user refusal', async () => {
    setPermissionConfirmer(async () => {
      throw new Error('renderer gone');
    });
    await expect(confirmPermission('gen_pdf', {}, undefined, { runId: 'run-1' })).rejects.toThrow('renderer gone');
    expect(listApprovals({ runId: 'run-1' })[0]).toMatchObject({ status: 'denied', decidedBy: 'error' });
  });

  it('still confirms when the database is not ready, without recording', async () => {
    state.ready = false;
    setPermissionConfirmer(async () => true);
    expect(await confirmPermission('gen_pdf', {}, undefined, { runId: 'run-1' })).toBe(true);
    state.ready = true;
    expect(listApprovals({ runId: 'run-1' })).toEqual([]);
  });

  it('binds a strict approval to the recorded call, canonical args and preview revision', async () => {
    startTaskRunStep({ runId: 'run-1', callId: 'call-1', toolName: 'submit_erp_report', riskLevel: 'high' });
    setPermissionConfirmer(async () => true);
    const args = { revision: 2, draft_id: 'draft-1' };
    const receipt = await confirmPermissionStrict('submit_erp_report', args, undefined, {
      runId: 'run-1', sessionId: 'session-1', callId: 'call-1', risk: 'high',
      preview: { kind: 'erp-work-report', target: 'draft-1', summary: '1 条报工', revision: 'preview-2' },
    });

    expect(receipt).toEqual({
      approved: true,
      approvalId: expect.any(String),
      argsDigest: digestPermissionArgs({ draft_id: 'draft-1', revision: 2 }),
      previewRevision: 'preview-2',
    });
    expect(listApprovals({ runId: 'run-1' })[0]).toMatchObject({
      id: receipt?.approvalId,
      callId: 'call-1',
      argsDigest: receipt?.argsDigest,
      previewRevision: 'preview-2',
      status: 'approved',
    });
  });

  it('fails closed before prompting when strict approval cannot be persisted or the step is missing', async () => {
    const confirmer = vi.fn(async () => true);
    setPermissionConfirmer(confirmer);
    await expect(confirmPermissionStrict('submit_erp_report', {}, undefined, {
      runId: 'run-1', sessionId: 'session-1', callId: 'missing', risk: 'high',
    })).rejects.toThrow('步骤尚未可靠记录');
    expect(confirmer).not.toHaveBeenCalled();

    state.ready = false;
    await expect(confirmPermissionStrict('submit_erp_report', {}, undefined, {
      runId: 'run-1', sessionId: 'session-1', callId: 'call-1', risk: 'high',
    })).rejects.toThrow('无法可靠记录本次审批');
    expect(confirmer).not.toHaveBeenCalled();
  });

  it('forces confirmation for high-risk tools even when policy would allow them', () => {
    const policy = {
      filesystem: { allowedRoots: [], writeAllowed: true, requireConfirmOnWrite: false },
      network: true,
      mcp: true,
      automation: { allowed: true, requireConfirm: false },
      shell: { allowed: true, requireConfirm: false },
    };
    const sendMail: ToolDefinition = {
      name: 'send_mail',
      description: 'test',
      category: 'mcp',
      requiresPermission: ['network'],
      sideEffects: { risk: 'high', idempotent: false, supportsPreview: false, reversible: 'none', evidence: 'output' },
      parameters: { type: 'object' },
      execute: async () => ({ success: true, output: '' }),
    };
    expect(checkPermission(sendMail, policy, {})).toBe('confirm');
    expect(checkPermission({ ...sendMail, sideEffects: undefined }, policy, {})).toBe('allow');
    expect(checkPermission({ ...sendMail, requiresPermission: ['shell'], sideEffects: undefined }, policy, {})).toBe('confirm');
    expect(checkPermission(sendMail, { ...policy, network: false }, {})).toBe('deny');
  });
});
