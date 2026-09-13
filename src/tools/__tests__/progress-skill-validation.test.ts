import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadExcelJS } from '../doc/exceljs-loader';
import {
  importTasksFromXlsxTool,
  normalizeImportedTaskStatus,
  updateUserTaskTool,
} from '../tasks/user-task-tools';
import { closeDatabase, initDatabase } from '../../db';
import { listUserTasks } from '../../db/user-tasks';

let integrationRoot = '';

beforeEach(async () => {
  integrationRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-task-integration-'));
  process.env.SHOREKEEPER_WORKSPACE_DIR = integrationRoot;
  await initDatabase(path.join(integrationRoot, 'tasks.db'));
});

afterEach(async () => {
  closeDatabase();
  delete process.env.SHOREKEEPER_WORKSPACE_DIR;
  await fs.rm(integrationRoot, { recursive: true, force: true });
});

describe('progress tracker validation', () => {
  it('does not silently coerce unknown task statuses', () => {
    expect(normalizeImportedTaskStatus('已延期')).toBeNull();
    expect(normalizeImportedTaskStatus('')).toBe('pending');
    expect(normalizeImportedTaskStatus('已完成')).toBe('done');
  });

  it('rejects an invalid row before opening a database transaction', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-task-import-'));
    const ExcelJS = await loadExcelJS();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Tasks');
    sheet.addRow(['任务', '状态', '截止']);
    sheet.addRow(['发布版本', '已延期', '下周']);
    await workbook.xlsx.writeFile(path.join(root, 'tasks.xlsx'));

    const result = await importTasksFromXlsxTool.execute(
      { path: 'tasks.xlsx' },
      { sessionId: 's1', workspaceRoot: root, signal: new AbortController().signal },
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('未写入任何待办');
    expect(result.error).toContain('状态无法识别');
    expect(result.error).toContain('截止日期须为 YYYY-MM-DD');
  });

  it('imports valid rows atomically and preserves workbook formulas when syncing status', async () => {
    const ExcelJS = await loadExcelJS();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Tasks');
    sheet.addRow(['任务', '状态', '截止', '计算']);
    sheet.addRow(['发布版本', '待开始', '2026-09-30', { formula: '1+1', result: 2 }]);
    await workbook.xlsx.writeFile(path.join(integrationRoot, 'tasks.xlsx'));
    const ctx = {
      sessionId: 's1',
      workspaceRoot: integrationRoot,
      signal: new AbortController().signal,
    };

    const imported = await importTasksFromXlsxTool.execute({ path: 'tasks.xlsx' }, ctx);
    expect(imported.success).toBe(true);
    const task = listUserTasks()[0];
    expect(task.status).toBe('pending');

    const updated = await updateUserTaskTool.execute({ id: task.id, status: 'done' }, ctx);
    expect(updated.success).toBe(true);
    expect(listUserTasks()[0].status).toBe('done');

    const verified = new ExcelJS.Workbook();
    await verified.xlsx.readFile(path.join(integrationRoot, 'tasks.xlsx'));
    expect(verified.getWorksheet('Tasks')?.getCell('B2').value).toBe('✅ 已完成');
    expect(verified.getWorksheet('Tasks')?.getCell('D2').value).toMatchObject({ formula: '1+1' });
  });

  it('rolls back the database update when Excel synchronization cannot complete', async () => {
    const ExcelJS = await loadExcelJS();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Tasks');
    sheet.addRow(['任务', '状态']);
    sheet.addRow(['发布版本', '待开始']);
    await workbook.xlsx.writeFile(path.join(integrationRoot, 'tasks.xlsx'));
    const ctx = {
      sessionId: 's1',
      workspaceRoot: integrationRoot,
      signal: new AbortController().signal,
    };
    expect((await importTasksFromXlsxTool.execute({ path: 'tasks.xlsx' }, ctx)).success).toBe(true);
    const task = listUserTasks()[0];

    const changed = new ExcelJS.Workbook();
    await changed.xlsx.readFile(path.join(integrationRoot, 'tasks.xlsx'));
    changed.getWorksheet('Tasks')!.getCell('B1').value = '说明';
    await changed.xlsx.writeFile(path.join(integrationRoot, 'tasks.xlsx'));

    const result = await updateUserTaskTool.execute({ id: task.id, status: 'done' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('数据库更新已撤销');
    expect(listUserTasks()[0].status).toBe('pending');
  });
});
