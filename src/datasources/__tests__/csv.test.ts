import { describe, expect, it } from 'vitest';
import { CSV_BOM, csvCell, toCsv } from '../csv';

describe('toCsv', () => {
  it('writes a BOM, CRLF rows and RFC 4180 quoting', () => {
    const csv = toCsv(['客户', '金额', '备注'], [
      ['星泓科技', 1234.5, '含"逗号",的'],
      ['岸边', null, 'two\nlines'],
    ]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.slice(1)).toBe('客户,金额,备注\r\n星泓科技,1234.5,"含""逗号"",的"\r\n岸边,,"two\nlines"\r\n');
  });

  it('keeps numbers and ISO dates raw and neutralises formula-looking text', () => {
    expect(csvCell(-12.5)).toBe('-12.5');
    expect(csvCell('2026-09-15 10:00:00')).toBe('2026-09-15 10:00:00');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell(new Date(Date.UTC(2026, 0, 2, 3, 4, 5)))).toBe('2026-01-02 03:04:05');
    expect(csvCell(Buffer.from('x'))).toBe('<binary>');
  });
});
