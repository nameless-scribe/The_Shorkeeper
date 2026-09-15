import { describe, expect, it } from 'vitest';
import { compileQueryPlan } from '../plan-compiler';
import { validateReadOnlySql } from '../sql-validator';
import { JOIN_ORDERS_CUSTOMERS, sampleDictionary, samplePlan } from './fixtures';

function compile(plan = samplePlan(), dictionary = sampleDictionary()) {
  const result = compileQueryPlan(plan, dictionary);
  if (!result.ok) throw new Error(result.error);
  return result.compiled;
}

function compileError(plan: ReturnType<typeof samplePlan>, dictionary = sampleDictionary()): string {
  const result = compileQueryPlan(plan, dictionary);
  if (result.ok) throw new Error(`expected an error, got ${result.compiled.sql}`);
  return result.error;
}

describe('compileQueryPlan', () => {
  it('aggregates at fact grain in a CTE before joining the dimension (no fan-out)', () => {
    const compiled = compile();
    expect(compiled.sql).toBe(
      'WITH f AS (SELECT f.`customer_id` AS `customer_id`, SUM(f.paid_amount - f.refund_amount) AS `销售额`, COUNT(DISTINCT f.id) AS `订单数` '
      + 'FROM `orders` f WHERE f.`paid_at` >= ? AND f.`paid_at` < ? AND f.`status` IN (?, ?) GROUP BY f.`customer_id`) '
      + 'SELECT d1.`name` AS `name`, f.`销售额` AS `销售额`, f.`订单数` AS `订单数` FROM f '
      + 'LEFT JOIN `customers` d1 ON f.`customer_id` = d1.`id` ORDER BY f.`销售额` DESC LIMIT 100',
    );
    expect(compiled.params).toEqual(['2026-08-01', '2026-09-01', '2', '3']);
    expect(compiled.columns).toEqual([
      { name: 'name', kind: 'grain' },
      { name: '销售额', kind: 'metric' },
      { name: '订单数', kind: 'metric' },
    ]);
    expect(compiled.raw).toBe(false);
    expect(compiled.warnings).toEqual([]);
  });

  it('emits self-checks for the overall total and the actual date coverage', () => {
    const compiled = compile();
    expect(compiled.selfChecks.map((check) => check.label)).toEqual(['整体合计', '日期覆盖']);
    expect(compiled.selfChecks[0].sql).toBe(
      'SELECT SUM(f.paid_amount - f.refund_amount) AS `销售额`, COUNT(DISTINCT f.id) AS `订单数` FROM `orders` f '
      + 'WHERE f.`paid_at` >= ? AND f.`paid_at` < ? AND f.`status` IN (?, ?) LIMIT 1',
    );
    expect(compiled.selfChecks[1].sql).toContain('SELECT MIN(f.`paid_at`) AS `最早`, MAX(f.`paid_at`) AS `最晚`');
    expect(compiled.selfChecks[1].params).toEqual(['2026-08-01', '2026-09-01', '2', '3']);
    for (const check of compiled.selfChecks) expect(validateReadOnlySql(check.sql).ok).toBe(true);
  });

  it('compiles an overall total without grain and orders by the first metric by default', () => {
    const compiled = compile(samplePlan({ dimensions: [], grain: [], orderBy: undefined, limit: 1 }));
    expect(compiled.sql).toBe(
      'WITH f AS (SELECT SUM(f.paid_amount - f.refund_amount) AS `销售额`, COUNT(DISTINCT f.id) AS `订单数` FROM `orders` f '
      + 'WHERE f.`paid_at` >= ? AND f.`paid_at` < ? AND f.`status` IN (?, ?)) '
      + 'SELECT f.`销售额` AS `销售额`, f.`订单数` AS `订单数` FROM f ORDER BY f.`销售额` DESC LIMIT 1',
    );
  });

  it('applies dimension filters after the join and fact filters inside the CTE', () => {
    const compiled = compile(samplePlan({
      filters: [
        { column: 'customers.is_test', op: 'eq', values: ['0'] },
        { column: 'orders.region', op: 'eq', values: ['华东'] },
      ],
    }));
    expect(compiled.sql).toContain("WHERE f.`paid_at` >= ? AND f.`paid_at` < ? AND f.`region` = ? GROUP BY");
    expect(compiled.sql).toContain('LEFT JOIN `customers` d1 ON f.`customer_id` = d1.`id` WHERE d1.`is_test` = ? ORDER BY');
    expect(compiled.params).toEqual(['2026-08-01', '2026-09-01', '华东', '0']);
  });

  it('compiles a month-over-month comparison as a second shifted CTE joined on the grain keys', () => {
    const compiled = compile(samplePlan({ compare: { kind: 'mom' }, metrics: [{ name: '销售额', fragment: 'SUM(f.paid_amount - f.refund_amount)' }] }));
    expect(compiled.sql).toContain('p AS (SELECT p.`customer_id` AS `customer_id`, SUM(p.paid_amount - p.refund_amount) AS `销售额` FROM `orders` p WHERE p.`paid_at` >= ? AND p.`paid_at` < ?');
    expect(compiled.sql).toContain('LEFT JOIN p ON f.`customer_id` <=> p.`customer_id`');
    expect(compiled.sql).toContain('(f.`销售额` - p.`销售额`) AS `销售额_差值`, ((f.`销售额` - p.`销售额`) / NULLIF(p.`销售额`, 0)) AS `销售额_增幅`');
    expect(compiled.params).toEqual(['2026-08-01', '2026-09-01', '2', '3', '2026-07-01', '2026-08-01', '2', '3']);
    expect(compiled.columns.map((c) => c.kind)).toEqual(['grain', 'metric', 'compare', 'compare', 'compare']);
  });

  it('shifts a year for year-over-year, including leap-day boundaries', () => {
    const compiled = compile(samplePlan({
      compare: { kind: 'yoy' },
      timeRange: { column: 'paid_at', from: '2024-02-01', to: '2024-03-01' },
      dimensions: [], grain: [],
    }));
    expect(compiled.params).toEqual(['2024-02-01', '2024-03-01', '2', '3', '2023-02-01', '2023-03-01', '2', '3']);
  });

  it('uses a grouped fact column directly when the grain is on the fact table', () => {
    const compiled = compile(samplePlan({ dimensions: [], grain: ['orders.region'] }));
    expect(compiled.sql).toContain('SELECT f.`region` AS `region`, SUM(');
    expect(compiled.sql).toContain('GROUP BY f.`region`) SELECT f.`region` AS `region`, f.`销售额`');
  });

  it('rejects shapes it cannot express with a clear reason', () => {
    expect(compileError(samplePlan({ unresolved: [{ slot: '时间范围', question: '看哪个月？' }] }))).toContain('未确定项');
    expect(compileError(samplePlan({ dimensions: [{ table: 'customers', join: 'orders.x->customers.id' }] }))).toContain('不在字典里');
    expect(compileError(samplePlan({ grain: ['products.name'] }))).toContain('不在方案的维度里');
    expect(compileError(samplePlan({ timeRange: { column: 'created_at', from: '2026-08-01', to: '2026-09-01' } }))).toContain('不在事实表');
    expect(compileError(samplePlan({ fact: { table: 'invoices' } }))).toContain('没有表 invoices');
    expect(compileError(samplePlan({ compare: { kind: 'yoy' }, timeRange: undefined }))).toContain('时间范围');
    expect(compileError(samplePlan({ metrics: [{ name: '销售额', fragment: 'SUM(f.paid_amount)' }] }))).toContain('口径与已定义的不一致');
  });

  it('refuses one-to-many joins as dimensions', () => {
    const dictionary = sampleDictionary();
    dictionary.tables.orders.manual.joins = dictionary.tables.orders.manual.joins.map((join) =>
      join.id === JOIN_ORDERS_CUSTOMERS ? { ...join, cardinality: '1:N' as const } : join,
    );
    expect(compileError(samplePlan(), dictionary)).toContain('一对多');
  });

  it('routes rawSql through the validator and the wrapper with no self-checks', () => {
    const compiled = compile(samplePlan({ rawSql: 'SELECT region, COUNT(*) AS n FROM orders GROUP BY region', metrics: [] }));
    expect(compiled.raw).toBe(true);
    expect(compiled.sql).toBe('SELECT * FROM (SELECT region, COUNT(*) AS n FROM orders GROUP BY region) AS _q LIMIT 100');
    expect(compiled.selfChecks).toEqual([]);
    expect(compiled.warnings).toContain('这个结果未经自动核对');
    expect(compileError(samplePlan({ rawSql: 'DELETE FROM orders', metrics: [] }))).toContain('未通过校验');
  });

  it('never lets a hostile identifier through', () => {
    expect(compileError(samplePlan({ grain: ['customers.name`; DROP TABLE x; --'] }))).toBeTruthy();
    expect(compileError(samplePlan({ metrics: [{ name: 'x`', fragment: 'COUNT(*)' }] }))).toContain('反引号');
  });

  it('produces SQL that passes the read-only validator for every shape', () => {
    const shapes = [samplePlan(), samplePlan({ compare: { kind: 'yoy' } }), samplePlan({ dimensions: [], grain: [] })];
    for (const plan of shapes) expect(validateReadOnlySql(compile(plan).sql, plan.limit).ok).toBe(true);
  });
});
