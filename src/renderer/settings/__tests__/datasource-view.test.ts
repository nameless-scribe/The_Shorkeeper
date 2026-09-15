import { describe, expect, it } from 'vitest';
import {
  describeRefreshResult,
  describeTestResult,
  formatEnumText,
  joinLabel,
  orderTimeColumnCandidates,
  parseEnumText,
  sourceStatus,
  tableMatchesSearch,
} from '../datasources/datasource-view';

describe('sourceStatus', () => {
  it('ranks failure, writable account, connected and untested', () => {
    expect(sourceStatus({ lastOkAt: null, lastError: null, writableAccount: null })).toEqual({ label: '未测试', tone: 'muted' });
    expect(sourceStatus({ lastOkAt: 1, lastError: null, writableAccount: false })).toEqual({ label: '已连通', tone: 'green' });
    expect(sourceStatus({ lastOkAt: 1, lastError: null, writableAccount: true }).tone).toBe('amber');
    expect(sourceStatus({ lastOkAt: 1, lastError: '密码不对', writableAccount: false }).label).toBe('连接失败');
  });
});

describe('enum text', () => {
  it('accepts =, :, ： and whitespace separators and round-trips', () => {
    const parsed = parseEnumText('1=待付款\n2：已付款\n3: 已退款\n4 已关闭\n\n无效行\n');
    expect(parsed).toEqual({ '1': '待付款', '2': '已付款', '3': '已退款', '4': '已关闭' });
    expect(parseEnumText(formatEnumText(parsed))).toEqual(parsed);
    expect(formatEnumText(undefined)).toBe('');
  });
});

describe('describeTestResult / describeRefreshResult', () => {
  it('turns a successful probe into readable lines including the time zone and latest timestamps', () => {
    const lines = describeTestResult({
      ok: true,
      serverVersion: '8.0.36',
      tableCount: 12,
      latencyMs: 35,
      writableAccount: false,
      writableEvidence: null,
      timeZone: { globalTimeZone: 'SYSTEM', sessionTimeZone: 'SYSTEM', systemTimeZone: 'CST', serverNow: '2026-09-15 10:00:00', serverUtcNow: '2026-09-15 02:00:00', offsetMinutes: 480, summary: '摘要' },
      latestTimestamps: [{ table: 'orders', column: 'paid_at', value: '2026-09-14 23:59:00' }],
      warnings: ['提醒'],
    });
    expect(lines[0]).toContain('8.0.36');
    expect(lines[1]).toBe('账号是只读的。');
    expect(lines).toContain('摘要');
    expect(lines.some((line) => line.includes('orders.paid_at') && line.includes('2026-09-14 23:59:00'))).toBe(true);
    expect(lines[lines.length - 1]).toBe('提醒');
  });

  it('reports failures with the translated reason and warnings', () => {
    expect(describeTestResult({ ok: false, error: '密码不对', warnings: ['SSL'] })).toEqual(['连接失败：密码不对', 'SSL']);
    expect(describeTestResult({ ok: true, writableAccount: null, warnings: [] })[1]).toContain('角色');
  });

  it('summarises a refresh', () => {
    expect(describeRefreshResult({ tables: 12, columns: 140, valueColumns: 9, scannedColumns: 20, skippedSamples: 1, durationMs: 4200 })).toBe(
      '已读取 12 张表、140 列，9 列建了取值表（扫了 20 列），1 张表的样例值没抓到，耗时 4.2 秒。人工填写的内容都还在。',
    );
  });
});

describe('small helpers', () => {
  it('labels joins, orders time columns first and searches by either name', () => {
    expect(joinLabel({ id: 'a.b->c.d', fromTable: 'a', fromColumn: 'b', toTable: 'c', toColumn: 'd', cardinality: 'N:1' })).toBe('a.b → c.d（N:1）');
    expect(orderTimeColumnCandidates([{ name: 'id', type: 'bigint' }, { name: 'paid_at', type: 'datetime' }, { name: 'day', type: 'date' }]).map((column) => column.name)).toEqual(['paid_at', 'day', 'id']);
    expect(tableMatchesSearch('orders', '订单', '订')).toBe(true);
    expect(tableMatchesSearch('orders', '订单', 'ORD')).toBe(true);
    expect(tableMatchesSearch('orders', undefined, '客户')).toBe(false);
    expect(tableMatchesSearch('orders', undefined, '  ')).toBe(true);
  });
});
