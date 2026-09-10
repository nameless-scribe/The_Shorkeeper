import { describe, expect, it } from 'vitest';
import { loadExcelJS } from '../exceljs-loader';

const DOCUMENT_LOADER_TIMEOUT_MS = 20_000;

describe('loadExcelJS', () => {
  it('returns a module with Workbook constructor', async () => {
    const ExcelJS = await loadExcelJS();
    expect(typeof ExcelJS.Workbook).toBe('function');
    const workbook = new ExcelJS.Workbook();
    expect(workbook.worksheets).toEqual([]);
  }, DOCUMENT_LOADER_TIMEOUT_MS);
});
