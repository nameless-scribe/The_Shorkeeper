/**
 * 查询结果 → CSV（计划 §11.7）：UTF-8 BOM（否则 Excel 打开中文乱码）、RFC 4180 引号、日期按服务器给的文本原样、数字不加千分位。
 */

export const CSV_BOM = '﻿';

export function csvCell(value: unknown): string {
  if (value == null) return '';
  let text: string;
  if (value instanceof Date) text = value.toISOString().replace('T', ' ').slice(0, 19);
  else if (typeof value === 'object') text = Buffer.isBuffer(value) ? '<binary>' : JSON.stringify(value);
  else text = String(value);
  // 以 = + - @ 开头的单元格在 Excel 里会被当公式，前面加一个撇号
  if (/^[=+\-@]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(columns: string[], rows: unknown[][]): string {
  const lines = [columns.map(csvCell).join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  return `${CSV_BOM}${lines.join('\r\n')}\r\n`;
}

/** 读回自己写的 CSV（BOM、引号、换行都按 RFC 4180）；第一行是表头 */
export function parseCsv(text: string): { columns: string[]; rows: string[][] } {
  const source = text.startsWith(CSV_BOM) ? text.slice(1) : text;
  const records: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r') {
      // CRLF 的 \r 忽略
    } else if (ch === '\n') {
      row.push(cell);
      records.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    records.push(row);
  }
  const [columns = [], ...rows] = records;
  return { columns, rows: rows.filter((item) => item.length > 1 || (item.length === 1 && item[0] !== '')) };
}

const NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/;

export type CsvColumnKind = 'number' | 'datetime' | 'text';

/** 一列全是数字（不含前导零的编号）才算数字列；全是 ISO 日期才算日期列；空值不参与 */
export function classifyCsvColumn(values: string[]): CsvColumnKind {
  const filled = values.filter((value) => value.trim() !== '');
  if (!filled.length) return 'text';
  if (filled.every((value) => NUMBER.test(value.trim()))) return 'number';
  if (filled.every((value) => DATETIME.test(value.trim()))) return 'datetime';
  return 'text';
}

/** ISO 文本 → 以 UTC 分量构造的 Date：Excel 没有时区，这样写进去的墙上时间与文本一致 */
export function isoToExcelDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(value.trim());
  if (!match) return null;
  const [, y, m, d, hh = '0', mm = '0', ss = '0'] = match;
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss)));
}
