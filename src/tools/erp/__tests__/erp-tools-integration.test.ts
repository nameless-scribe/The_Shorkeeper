import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDatabaseAsync, initDatabase } from '../../../db';
import { setSetting } from '../../../db/app-settings';
import { insertMessage } from '../../../db/repositories/messages';
import { createSession } from '../../../db/repositories/sessions';
import { setErpRuntime } from '../../../erp/runtime';
import type { ErpReadContext } from '../../../erp/read-client';
import { getErpReportDraft } from '../../../db/repositories/erp-work-reports';
import { prepareErpReportTool } from '../erp-tools';

describe('prepare_erp_report integration', () => {
  let tempDir = '';
  let sessionId = '';
  const baseContext: ErpReadContext = {
    identity: { userId: '7', userName: '苏运来' },
    tasks: [{ taskId: '1001', taskName: 'APS 自动排产系统调整', projectName: '光拓智能日常', ownerId: '7', ownerName: '苏运来', actualMinutes: 180 }],
    entries: [], existingMinutes: 0,
  };
  let context = baseContext;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shorekeeper-erp-tool-'));
    await initDatabase(path.join(tempDir, 'tool.db'));
    setSetting('erp.enabled', '1'); setSetting('erp.origin', 'http://erp.test'); setSetting('erp.apiPrefix', '/prod-api');
    sessionId = createSession(undefined, 'ERP 测试').id;
    insertMessage(sessionId, 'user', 'APS 调了三个半小时，帮我整理报工');
    setErpRuntime({
      connect: async () => ({ state: 'authenticated', origin: 'http://erp.test', browserChannel: 'msedge', pageUrl: 'http://erp.test/taskboard/index', userId: '7', userName: '苏运来', message: '已登录' }),
      status: () => ({ state: 'authenticated', origin: 'http://erp.test', browserChannel: 'msedge', pageUrl: 'http://erp.test/taskboard/index', userId: '7', userName: '苏运来', message: '已登录' }),
      readContext: async () => context,
      submitTimeEntry: async () => ({ status: 'accepted' }),
    });
  });

  afterAll(async () => {
    setErpRuntime(null); await closeDatabaseAsync(); fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('validates the live task and persists a source-linked draft', async () => {
    context = baseContext;
    const result = await prepareErpReportTool.execute({ work_date: '2026-09-21', items: [{
      item_id: 'aps', task_id: '1001', task_name: 'APS 自动排产系统调整', project_name: '光拓智能日常',
      work_hours: 3.5, work_content: '调整排产算法，修复扫描问题。', duration_estimated: false,
    }] }, { sessionId, workspaceRoot: tempDir, signal: new AbortController().signal });
    expect(result).toMatchObject({ success: true, metadata: { revision: 1, status: 'ready', existingMinutes: 0, draftMinutes: 210 } });
    const draft = getErpReportDraft(String(result.metadata?.draftId));
    expect(draft?.items[0].sourceMessageIds).toHaveLength(1);
    expect(draft?.erpUserId).toBe('7');
  });

  it('blocks an exact possible duplicate until the user explicitly overrides it', async () => {
    context = { ...baseContext, entries: [{ timeEntryId: '31', taskId: '1001', ownerId: '7', workDate: '2026-09-22', workMinutes: 210, workContent: '调整排产算法，修复扫描问题。', createBy: '苏运来' }], existingMinutes: 210 };
    const args = { work_date: '2026-09-22', items: [{ task_id: '1001', task_name: 'APS 自动排产系统调整', project_name: '光拓智能日常', work_hours: 3.5, work_content: '调整排产算法，修复扫描问题。' }] };
    const blocked = await prepareErpReportTool.execute(args, { sessionId, workspaceRoot: tempDir, signal: new AbortController().signal });
    expect(blocked).toMatchObject({ success: false });
    expect(blocked.error).toContain('已有一条');
  });

  it('does not create a second open draft for the same session and date', async () => {
    context = baseContext;
    const result = await prepareErpReportTool.execute({ work_date: '2026-09-21', items: [{ task_id: '1001', task_name: 'APS 自动排产系统调整', project_name: '光拓智能日常', work_hours: 1, work_content: '重复调用' }] }, { sessionId, workspaceRoot: tempDir, signal: new AbortController().signal });
    expect(result).toMatchObject({ success: false });
    expect(result.error).toContain('已有未完成草稿');
  });

  it('does not revise an old-site draft after the configured ERP site changes', async () => {
    context = baseContext;
    const args = { work_date: '2026-09-24', items: [{ item_id: 'aps-site', task_id: '1001', task_name: 'APS 自动排产系统调整',
      project_name: '光拓智能日常', work_hours: 1, work_content: '整理跨站点验证。' }] };
    const toolContext = { sessionId, workspaceRoot: tempDir, signal: new AbortController().signal };
    const created = await prepareErpReportTool.execute(args, toolContext);
    expect(created.success).toBe(true);
    setSetting('erp.origin', 'http://another-erp.test');
    try {
      const revised = await prepareErpReportTool.execute({ ...args, draft_id: created.metadata?.draftId,
        expected_revision: 1 }, toolContext);
      expect(revised).toMatchObject({ success: false });
      expect(revised.error).toContain('站点已变化');
      expect(getErpReportDraft(String(created.metadata?.draftId))?.revision).toBe(1);
    } finally {
      setSetting('erp.origin', 'http://erp.test');
    }
  });
});
