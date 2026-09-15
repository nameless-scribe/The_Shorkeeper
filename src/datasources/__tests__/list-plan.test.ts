import { describe, expect, it } from 'vitest';
import { compileQueryPlan } from '../plan-compiler';
import { containsTechnicalTerms, renderQueryPlan } from '../plan-render';
import { isListPlan, parseQueryPlan } from '../query-plan';
import { JOIN_ORDERS_CUSTOMERS, sampleDictionary, samplePlan } from './fixtures';

const listPlan = (overrides: Record<string, unknown> = {}) => ({
  sourceId: 'src-1',
  fact: { table: 'orders' },
  dimensions: [{ table: 'customers', join: JOIN_ORDERS_CUSTOMERS }],
  timeRange: { column: 'paid_at', from: '2026-09-01', to: '2026-10-01' },
  filters: [{ column: 'orders.status', op: 'eq', values: ['1'] }],
  select: ['orders.id', 'customers.name', 'orders.paid_amount', 'orders.paid_at'],
  metrics: [],
  limit: 50,
  ...overrides,
});

describe('list mode plans', () => {
  it('parses select-only plans and rejects mixing with grain or metrics', () => {
    const parsed = parseQueryPlan(listPlan());
    expect('plan' in parsed && isListPlan(parsed.plan)).toBe(true);
    expect('plan' in parsed && parsed.plan.select).toEqual(['orders.id', 'customers.name', 'orders.paid_amount', 'orders.paid_at']);

    expect(parseQueryPlan(listPlan({ grain: ['customers.name'] }))).toMatchObject({ error: expect.stringContaining('清单模式') });
    expect(parseQueryPlan(listPlan({ metrics: [{ name: '销售额', fragment: 'SUM(f.paid_amount)' }] }))).toMatchObject({ error: expect.stringContaining('清单模式') });
    expect(parseQueryPlan(listPlan({ select: ['orders'] }))).toMatchObject({ error: expect.stringContaining('表.列') });
    expect(parseQueryPlan(listPlan({ select: [], metrics: [] }))).toMatchObject({ error: expect.stringContaining('至少要有一个指标') });
    expect(parseQueryPlan(listPlan({ orderBy: { metric: '销售额', direction: 'desc' } }))).toMatchObject({ error: expect.stringContaining('某一列') });
    expect('plan' in parseQueryPlan(listPlan({ orderBy: { metric: 'orders.paid_amount', direction: 'asc' } }))).toBe(true);
  });

  it('compiles a list plan with joins, filters, default time ordering and row-count self-check', () => {
    const dictionary = sampleDictionary();
    const parsed = parseQueryPlan(listPlan());
    if ('error' in parsed) throw new Error(parsed.error);
    const result = compileQueryPlan(parsed.plan, dictionary);
    if (!result.ok) throw new Error(result.error);
    const { compiled } = result;
    expect(compiled.list).toBe(true);
    expect(compiled.raw).toBe(false);
    expect(compiled.sql).toBe(
      'SELECT f.`id` AS `id`, d1.`name` AS `name`, f.`paid_amount` AS `paid_amount`, f.`paid_at` AS `paid_at` ' +
        'FROM `orders` f LEFT JOIN `customers` d1 ON f.`customer_id` = d1.`id` ' +
        'WHERE f.`paid_at` >= ? AND f.`paid_at` < ? AND f.`status` = ? ORDER BY f.`paid_at` DESC LIMIT 50',
    );
    expect(compiled.params).toEqual(['2026-09-01', '2026-10-01', '1']);
    expect(compiled.columns.map((column) => column.kind)).toEqual(['field', 'field', 'field', 'field']);
    expect(compiled.columns[1]).toMatchObject({ name: 'name', table: 'customers', column: 'name' });
    expect(compiled.selfChecks.map((check) => check.label)).toEqual(['总行数', '日期覆盖']);
    expect(compiled.selfChecks[0].sql).toContain('COUNT(*)');
    expect(compiled.selfChecks[0].sql).toContain('LEFT JOIN `customers`');
    expect(compiled.selfChecks[0].params).toEqual(compiled.params);
  });

  it('honours explicit ordering, aliases duplicate column names and rejects unknown fact columns', () => {
    const dictionary = sampleDictionary();
    const ordered = parseQueryPlan(listPlan({ select: ['orders.id', 'customers.id'], orderBy: { metric: 'orders.paid_amount', direction: 'asc' } }));
    if ('error' in ordered) throw new Error(ordered.error);
    const compiled = compileQueryPlan(ordered.plan, dictionary);
    if (!compiled.ok) throw new Error(compiled.error);
    expect(compiled.compiled.sql).toContain('d1.`id` AS `customers_id`');
    expect(compiled.compiled.sql).toContain('ORDER BY f.`paid_amount` ASC');
    expect(compiled.compiled.columns[1].name).toBe('customers_id');

    const unknown = parseQueryPlan(listPlan({ select: ['orders.ghost'] }));
    if ('error' in unknown) throw new Error(unknown.error);
    expect(compileQueryPlan(unknown.plan, dictionary)).toMatchObject({ ok: false, error: expect.stringContaining('没有列 ghost') });
  });

  it('renders list plans in business language without technical terms', () => {
    const dictionary = sampleDictionary();
    dictionary.tables.orders.columns.id = { businessName: '订单号' };
    dictionary.tables.orders.columns.paid_amount = { businessName: '实付金额' };
    dictionary.tables.orders.columns.paid_at = { businessName: '付款时间' };
    const parsed = parseQueryPlan(listPlan());
    if ('error' in parsed) throw new Error(parsed.error);
    const rendering = renderQueryPlan(parsed.plan, dictionary);
    expect(rendering.summary).toBe('我准备这样列：2026 年 9 月（按付款时间），订单清单，每条给出订单号、客户名称、实付金额、付款时间，只算订单状态是「待付款」，按付款时间从新到旧取前 50 条。');
    expect(rendering.lines).toContain('列出：订单号、客户名称、实付金额、付款时间');
    expect(rendering.lines).not.toContain('整体汇总，不拆分');
    expect(rendering.missingNames).toEqual([]);
    expect(containsTechnicalTerms(rendering.summary)).toBe(false);
  });

  it('keeps aggregate plans unchanged and labels grain columns with their table', () => {
    const dictionary = sampleDictionary();
    const compiled = compileQueryPlan(samplePlan(), dictionary);
    if (!compiled.ok) throw new Error(compiled.error);
    expect(compiled.compiled.list).toBe(false);
    expect(compiled.compiled.columns[0]).toMatchObject({ name: 'name', kind: 'grain', table: 'customers', column: 'name' });
  });
});
