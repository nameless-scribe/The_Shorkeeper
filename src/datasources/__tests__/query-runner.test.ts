import { describe, expect, it } from 'vitest';
import type { QueryResult } from '../mysql-connector';
import { compileQueryPlan, type CompiledPlan } from '../plan-compiler';
import { parseQueryPlan } from '../query-plan';
import { estimateExplainRows, evaluateSelfChecks, runCompiledQuery } from '../query-runner';
import { JOIN_ORDERS_CUSTOMERS, sampleDictionary, samplePlan } from './fixtures';

function compileSample(): CompiledPlan {
  const result = compileQueryPlan(samplePlan(), sampleDictionary());
  if (!result.ok) throw new Error(result.error);
  return result.compiled;
}

function compileList(): CompiledPlan {
  const parsed = parseQueryPlan({
    sourceId: 'src-1',
    fact: { table: 'orders' },
    dimensions: [{ table: 'customers', join: JOIN_ORDERS_CUSTOMERS }],
    timeRange: { column: 'paid_at', from: '2026-09-01', to: '2026-10-01' },
    filters: [],
    select: ['orders.id', 'customers.name'],
    metrics: [],
    limit: 2,
  });
  if ('error' in parsed) throw new Error(parsed.error);
  const result = compileQueryPlan(parsed.plan, sampleDictionary());
  if (!result.ok) throw new Error(result.error);
  return result.compiled;
}

const metrics = samplePlan().metrics;

function result(columns: string[], rows: unknown[][], truncated = false): QueryResult {
  return { columns, rows, truncated, durationMs: 5 };
}

describe('estimateExplainRows', () => {
  it('multiplies per-table row estimates and ignores missing values', () => {
    expect(estimateExplainRows([{ rows: 1000 }, { rows: '3' }, { rows: null }])).toBe(3000);
    expect(estimateExplainRows([{ id: 1 }])).toBeNull();
    expect(estimateExplainRows([{ rows: 1e12 }, { rows: 1e12 }])).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('evaluateSelfChecks', () => {
  it('passes when grouped SUM totals match the overall total within tolerance and skips COUNT DISTINCT', () => {
    const compiled = compileSample();
    const main = result(['name', '销售额', '订单数'], [['A', 100.004, 3], ['B', 50, 2]]);
    const report = evaluateSelfChecks(compiled, metrics, main, [
      { label: '整体合计', result: result(['销售额', '订单数'], [[150, 4]]) },
      { label: '日期覆盖', result: result(['最早', '最晚'], [['2026-08-02 10:00:00', '2026-08-30 09:00:00']]) },
    ]);
    expect(report.failed).toBe(false);
    expect(report.items[0]).toMatchObject({ ok: true, detail: '1 个指标的分组合计与整体一致' });
    expect(report.notes).toEqual(['实际有数据的时间是 2026-08-02 到 2026-08-30']);
  });

  it('fails when the grouped total drifts from the overall total (join amplification)', () => {
    const compiled = compileSample();
    const main = result(['name', '销售额', '订单数'], [['A', 100, 3], ['A', 100, 3]]);
    const report = evaluateSelfChecks(compiled, metrics, main, [{ label: '整体合计', result: result(['销售额', '订单数'], [[100, 3]]) }]);
    expect(report.failed).toBe(true);
    expect(report.items[0]).toMatchObject({ ok: false, detail: '销售额：分组相加 200，整体 100' });
  });

  it('skips the total check for truncated results and reports failed check queries without failing', () => {
    const compiled = compileSample();
    const main = result(['name', '销售额', '订单数'], [['A', 100, 3]], true);
    const report = evaluateSelfChecks(compiled, metrics, main, [
      { label: '整体合计', result: result(['销售额', '订单数'], [[999, 9]]) },
      { label: '日期覆盖', error: 'timeout' },
    ]);
    expect(report.failed).toBe(false);
    expect(report.items[0].ok).toBeNull();
    expect(report.items[1]).toMatchObject({ ok: null, detail: '自检没跑成：timeout' });
    expect(report.notes[0]).toContain('只列了前 1 条');
  });

  it('explains list-mode row counts and empty date coverage', () => {
    const compiled = compileList();
    const main = result(['id', 'name'], [[1, 'A'], [2, 'B']], true);
    const report = evaluateSelfChecks(compiled, [], main, [
      { label: '总行数', result: result(['总行数'], [['7']]) },
      { label: '日期覆盖', result: result(['最早', '最晚'], [[null, null]]) },
    ]);
    expect(report.failed).toBe(false);
    expect(report.notes).toEqual(['符合条件的共 7 条，这里只列了前 2 条', '这段时间里没有任何记录']);
  });
});

describe('runCompiledQuery', () => {
  function connector(options: { explainRows?: number; explainError?: Error; queryError?: Error; totals?: unknown[] } = {}) {
    const calls: string[] = [];
    return {
      calls,
      explain: async () => {
        calls.push('explain');
        if (options.explainError) throw options.explainError;
        return [{ rows: options.explainRows ?? 10 }];
      },
      query: async (sql: string) => {
        calls.push(sql.startsWith('WITH') ? 'main' : sql.includes('MIN(') ? 'dates' : 'total');
        if (options.queryError && sql.startsWith('WITH')) throw options.queryError;
        if (sql.startsWith('WITH')) return result(['name', '销售额', '订单数'], [['A', 100, 3], ['B', 50, 2]]);
        if (sql.includes('MIN(')) return result(['最早', '最晚'], [['2026-08-01', '2026-08-31']]);
        return result(['销售额', '订单数'], [options.totals ?? [150, 5]]);
      },
    };
  }

  it('explains first, then runs the query and both self-checks together', async () => {
    const fake = connector();
    const outcome = await runCompiledQuery(fake, compileSample(), metrics, { maxRows: 100 });
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    expect(outcome.estimatedRows).toBe(10);
    expect(outcome.result.rows).toHaveLength(2);
    expect(outcome.checks.failed).toBe(false);
    expect(fake.calls[0]).toBe('explain');
    expect(fake.calls.slice(1).sort()).toEqual(['dates', 'main', 'total']);
  });

  it('stops before running when the estimate exceeds the threshold, and surfaces db errors by phase', async () => {
    const heavy = await runCompiledQuery(connector({ explainRows: 5_000_000 }), compileSample(), metrics, { maxRows: 100 });
    expect(heavy).toEqual({ status: 'too_many_rows', estimatedRows: 5_000_000 });

    const explainError = Object.assign(new Error("Unknown column 'x'"), { code: 'ER_BAD_FIELD_ERROR' });
    const failedExplain = await runCompiledQuery(connector({ explainError }), compileSample(), metrics, { maxRows: 100 });
    expect(failedExplain).toMatchObject({ status: 'db_error', phase: 'explain', code: 'ER_BAD_FIELD_ERROR' });

    const queryError = Object.assign(new Error('timeout'), { code: 'ER_QUERY_TIMEOUT' });
    const failedQuery = await runCompiledQuery(connector({ queryError }), compileSample(), metrics, { maxRows: 100, skipExplain: true });
    expect(failedQuery).toMatchObject({ status: 'db_error', phase: 'query', code: 'ER_QUERY_TIMEOUT' });
  });

  it('withholds results that fail the total check', async () => {
    const outcome = await runCompiledQuery(connector({ totals: [100, 5] }), compileSample(), metrics, { maxRows: 100 });
    expect(outcome.status).toBe('check_failed');
    if (outcome.status !== 'check_failed') return;
    expect(outcome.checks.items[0].ok).toBe(false);
  });
});
