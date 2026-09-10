import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseXlsxFile } from '../../tools/doc/parse-xlsx';
import { loadExcelJS } from '../../tools/doc/exceljs-loader';
import { enrichAttachmentsMessage } from '../attachment-preparse';
import * as paths from '../../config/paths';

const DOCUMENT_LOADER_TIMEOUT_MS = 20_000;

describe('parseXlsxFile', () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it('reads headers and rows from xlsx', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shore-xlsx-'));
    tmpDirs.push(root);
    const filePath = 'sample.xlsx';
    const absolute = path.join(root, filePath);

    const ExcelJS = await loadExcelJS();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.addRow(['模块', '状态']);
    sheet.addRow(['P1', '已完成']);
    await workbook.xlsx.writeFile(absolute);

    const parsed = await parseXlsxFile(root, filePath);
    expect(parsed.headers).toEqual(['模块', '状态']);
    expect(parsed.rows).toEqual([['P1', '已完成']]);
    expect(parsed.total_rows).toBe(1);
  }, DOCUMENT_LOADER_TIMEOUT_MS);
});

describe('enrichAttachmentsMessage', () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it('injects parsed xlsx block', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shore-pre-'));
    tmpDirs.push(root);
    const relativePath = 'task.xlsx';
    const absolute = path.join(root, relativePath);

    const ExcelJS = await loadExcelJS();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Tasks');
    sheet.addRow(['任务', '状态']);
    sheet.addRow(['模块A', '待开始']);
    await workbook.xlsx.writeFile(absolute);

    vi.spyOn(paths, 'getWorkspaceDir').mockReturnValue(root);

    const msg = await enrichAttachmentsMessage('请分析', [
      { relativePath, originalName: 'task.xlsx', size: 100 },
    ]);
    expect(msg).toContain('[工作区附件已解析]');
    expect(msg).toContain('模块A');
  }, DOCUMENT_LOADER_TIMEOUT_MS);
});
