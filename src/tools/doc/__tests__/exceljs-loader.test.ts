import { describe, expect, it } from 'vitest';
import { loadExcelJS } from '../exceljs-loader';

describe('loadExcelJS', () => {
  it('returns a module with Workbook constructor', async () => {
    const ExcelJS = await loadExcelJS();
    expect(typeof ExcelJS.Workbook).toBe('function');
    const workbook = new ExcelJS.Workbook();
    expect(workbook.worksheets).toEqual([]);
  });
});
