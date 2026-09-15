import { describe, expect, it } from 'vitest';
import { isPlanReady, parseQueryPlan, PLAN_DEFAULT_LIMIT } from '../query-plan';
import { samplePlan } from './fixtures';

function error(value: unknown): string {
  const parsed = parseQueryPlan(value);
  if (!('error' in parsed)) throw new Error('expected an error');
  return parsed.error;
}

describe('parseQueryPlan', () => {
  it('accepts a complete plan and normalizes it', () => {
    const parsed = parseQueryPlan({ ...samplePlan(), grain: ['customers.name', 'customers.name'] });
    expect('plan' in parsed).toBe(true);
    if (!('plan' in parsed)) return;
    expect(parsed.plan.grain).toEqual(['customers.name']);
    expect(parsed.plan.limit).toBe(100);
    expect(isPlanReady(parsed.plan)).toBe(true);
  });

  it('defaults the limit and accepts numeric filter values', () => {
    const parsed = parseQueryPlan({
      sourceId: 's',
      fact: { table: 'orders' },
      metrics: [{ name: '订单数', fragment: 'COUNT(*)' }],
      filters: [{ column: 'orders.status', op: 'eq', values: [2] }],
    });
    if (!('plan' in parsed)) throw new Error(parsed.error);
    expect(parsed.plan.limit).toBe(PLAN_DEFAULT_LIMIT);
    expect(parsed.plan.filters[0].values).toEqual(['2']);
    expect(parsed.plan.dimensions).toEqual([]);
  });

  it('keeps unresolved questions and marks the plan not ready', () => {
    const parsed = parseQueryPlan(samplePlan({ unresolved: [{ slot: '范围过滤', question: '要不要剔除测试账号？', options: ['剔除', '保留'] }] }));
    if (!('plan' in parsed)) throw new Error(parsed.error);
    expect(isPlanReady(parsed.plan)).toBe(false);
    expect(parsed.plan.unresolved[0].options).toEqual(['剔除', '保留']);
  });

  it.each([
    [null, '方案必须是对象'],
    [{}, '缺少 sourceId'],
    [{ sourceId: 's' }, 'fact.table'],
    [{ sourceId: 's', fact: { table: 'orders; drop' }, metrics: [] }, 'fact.table'],
    [{ sourceId: 's', fact: { table: 'orders' }, metrics: [] }, '至少要有一个指标'],
    [{ sourceId: 's', fact: { table: 'orders' }, metrics: [{ name: 'x', fragment: 'COUNT(*)' }], grain: ['name'] }, '表.列'],
    [{ sourceId: 's', fact: { table: 'orders' }, metrics: [{ name: 'x', fragment: 'COUNT(*)' }], timeRange: { column: 'paid_at', from: '2026-09-01', to: '2026-08-01' } }, '左闭右开'],
    [{ sourceId: 's', fact: { table: 'orders' }, metrics: [{ name: 'x', fragment: 'COUNT(*)' }], timeRange: { column: 'paid_at', from: 'yesterday', to: '2026-08-01' } }, 'ISO 日期'],
    [{ sourceId: 's', fact: { table: 'orders' }, metrics: [{ name: 'x', fragment: 'COUNT(*)' }], filters: [{ column: 'orders.status', op: 'eq', values: ['1', '2'] }] }, '只能有一个值'],
    [{ sourceId: 's', fact: { table: 'orders' }, metrics: [{ name: 'x', fragment: 'COUNT(*)' }], filters: [{ column: 'orders.status', op: 'between', values: ['1'] }] }, 'op 无效'],
    [{ sourceId: 's', fact: { table: 'orders' }, metrics: [{ name: 'x', fragment: 'COUNT(*)' }, { name: 'x', fragment: 'SUM(a)' }] }, '指标重复'],
    [{ sourceId: 's', fact: { table: 'orders' }, metrics: [{ name: 'x', fragment: 'COUNT(*)' }], orderBy: { metric: 'y', direction: 'desc' } }, 'orderBy.metric'],
    [{ sourceId: 's', fact: { table: 'orders' }, metrics: [{ name: 'x', fragment: 'COUNT(*)' }], limit: 0 }, 'limit'],
    [{ sourceId: 's', fact: { table: 'orders' }, metrics: [{ name: 'x', fragment: 'COUNT(*)' }], limit: 5001 }, 'limit'],
    [{ sourceId: 's', fact: { table: 'orders' }, metrics: [{ name: 'x', fragment: 'COUNT(*)' }], compare: { kind: 'wow' } }, 'compare.kind'],
    [{ sourceId: 's', fact: { table: 'orders' }, metrics: [{ name: 'x', fragment: 'COUNT(*)' }], dimensions: [{ table: 'customers' }] }, '缺少 join'],
    [{ sourceId: 's', fact: { table: 'orders' }, metrics: [{ name: 'x', fragment: 'COUNT(*)' }], unresolved: [{ slot: '颜色', question: '?' }] }, 'slot 无效'],
  ])('rejects invalid plan %#', (value, fragment) => {
    expect(error(value)).toContain(fragment);
  });

  it('accepts the raw SQL escape hatch without metrics', () => {
    const parsed = parseQueryPlan({ sourceId: 's', fact: { table: 'orders' }, metrics: [], rawSql: 'SELECT 1' });
    if (!('plan' in parsed)) throw new Error(parsed.error);
    expect(parsed.plan.rawSql).toBe('SELECT 1');
  });
});
