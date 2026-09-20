/**
 * 执行一份编译好的方案（P7.2，计划 §3.4、§3.5、§3.13.3）：
 * EXPLAIN → 行数估计超阈值先停 → 主查询与自检并行 → 自检不过就不给结果。
 * 只依赖连接器接口，测试用假连接器。
 */
import type { CompiledPlan } from './plan-compiler';
import type { MysqlConnector, QueryResult } from './mysql-connector';

export const EXPLAIN_ROW_THRESHOLD = 2_000_000;
/** 合计核对的相对容差 */
export const CHECK_TOLERANCE = 0.005;

export interface SelfCheckItem {
  label: string;
  /** null = 自检本身没跑成 */
  ok: boolean | null;
  detail: string;
}

export interface SelfCheckReport {
  items: SelfCheckItem[];
  failed: boolean;
  /** true = 至少一项本应执行的核对没有得到结论，交付时必须明确提示 */
  incomplete: boolean;
  /** 给回复用的业务语言说明（覆盖范围、只列了前 N 条等） */
  notes: string[];
}

export type RunQueryOutcome =
  | { status: 'ok'; result: QueryResult; estimatedRows: number | null; checks: SelfCheckReport }
  | { status: 'db_error'; phase: 'explain' | 'query'; code: string; message: string }
  | { status: 'too_many_rows'; estimatedRows: number }
  | { status: 'check_failed'; result: QueryResult; estimatedRows: number | null; checks: SelfCheckReport };

export interface RunQueryOptions {
  maxRows: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  explainRowThreshold?: number;
  /** 跳过 EXPLAIN（自检查询、逃生口以外的小查询不需要） */
  skipExplain?: boolean;
}

/** MySQL EXPLAIN 每行一张表的 rows 估计；连接的代价是乘积，封顶避免溢出 */
export function estimateExplainRows(rows: Array<Record<string, unknown>>): number | null {
  let product = 1;
  let seen = false;
  for (const row of rows) {
    const raw = row.rows ?? row.ROWS;
    const value = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(value) || value <= 0) continue;
    seen = true;
    product = Math.min(Number.MAX_SAFE_INTEGER, product * value);
  }
  return seen ? Math.round(product) : null;
}

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

const ADDITIVE = /^\s*(SUM|COUNT)\s*\(/i;
const COUNT_DISTINCT = /^\s*COUNT\s*\(\s*DISTINCT\b/i;

/**
 * 自检评估（纯函数）。
 * 聚合方案：分组合计 vs 整体合计，只对 SUM / COUNT（非 DISTINCT）这类可加指标比；结果被截断时跳过。
 * 清单方案：总行数 vs 返回行数，只做说明不算失败。日期覆盖只做说明。
 */
export function evaluateSelfChecks(
  compiled: CompiledPlan,
  metricFragments: Array<{ name: string; fragment: string }>,
  result: QueryResult,
  checkResults: Array<{ label: string; result?: QueryResult; error?: string }>,
): SelfCheckReport {
  const items: SelfCheckItem[] = [];
  const notes: string[] = [];
  let failed = false;
  let incomplete = false;
  const compareMode = compiled.columns.some((column) => column.kind === 'compare');

  for (const check of checkResults) {
    if (!check.result) {
      items.push({ label: check.label, ok: null, detail: `自检没跑成：${check.error ?? '未知原因'}` });
      incomplete = true;
      notes.push(`${check.label}自动核对未完成，当前结果未完全核验`);
      continue;
    }
    const row = check.result.rows[0] ?? [];
    const columnIndex = (name: string) => check.result!.columns.indexOf(name);

    if (check.label === '整体合计') {
      if (compareMode) {
        items.push({ label: check.label, ok: null, detail: '对比周期的结果不做合计核对' });
        continue;
      }
      if (result.truncated) {
        items.push({ label: check.label, ok: null, detail: `只取了前 ${result.rows.length} 条，合计核对跳过` });
        incomplete = true;
        notes.push(`结果超过 ${result.rows.length} 条，只列了前 ${result.rows.length} 条`);
        continue;
      }
      const mismatches: string[] = [];
      let compared = 0;
      for (const metric of metricFragments) {
        if (!ADDITIVE.test(metric.fragment) || COUNT_DISTINCT.test(metric.fragment)) continue;
        const totalIndex = columnIndex(metric.name);
        const resultIndex = result.columns.indexOf(metric.name);
        if (totalIndex < 0 || resultIndex < 0) continue;
        const total = toNumber(row[totalIndex]);
        if (total === null) continue;
        compared += 1;
        const sum = result.rows.reduce((acc, item) => acc + (toNumber(item[resultIndex]) ?? 0), 0);
        const tolerance = Math.max(Math.abs(total) * CHECK_TOLERANCE, 0.01);
        if (Math.abs(sum - total) > tolerance) mismatches.push(`${metric.name}：分组相加 ${sum}，整体 ${total}`);
      }
      if (!compared) {
        items.push({ label: check.label, ok: null, detail: '没有可加指标（平均值、去重计数不做合计核对）' });
      } else if (mismatches.length) {
        failed = true;
        items.push({ label: check.label, ok: false, detail: mismatches.join('；') });
      } else {
        items.push({ label: check.label, ok: true, detail: `${compared} 个指标的分组合计与整体一致` });
      }
      continue;
    }

    if (check.label === '总行数') {
      const total = toNumber(row[columnIndex('总行数')]);
      if (total === null) {
        items.push({ label: check.label, ok: null, detail: '没拿到总行数' });
        incomplete = true;
        notes.push('总行数自动核对未完成，当前结果未完全核验');
      } else if (total > result.rows.length) {
        items.push({ label: check.label, ok: true, detail: `共 ${total} 条，列了前 ${result.rows.length} 条` });
        notes.push(`符合条件的共 ${total} 条，这里只列了前 ${result.rows.length} 条`);
      } else {
        items.push({ label: check.label, ok: true, detail: `共 ${total} 条，已全部列出` });
      }
      continue;
    }

    if (check.label === '日期覆盖') {
      const earliest = row[columnIndex('最早')];
      const latest = row[columnIndex('最晚')];
      if (earliest == null) {
        items.push({ label: check.label, ok: true, detail: '这段时间没有数据' });
        notes.push('这段时间里没有任何记录');
      } else {
        items.push({ label: check.label, ok: true, detail: `实际数据从 ${String(earliest)} 到 ${String(latest)}` });
        notes.push(`实际有数据的时间是 ${String(earliest).slice(0, 10)} 到 ${String(latest).slice(0, 10)}`);
      }
      continue;
    }

    items.push({ label: check.label, ok: null, detail: '未知的自检' });
    incomplete = true;
    notes.push(`${check.label}自动核对未完成，当前结果未完全核验`);
  }

  if (compiled.raw) {
    incomplete = true;
    notes.push('这个结果未经自动核对');
  }
  return { items, failed, incomplete, notes };
}

export async function runCompiledQuery(
  connector: Pick<MysqlConnector, 'explain' | 'query'>,
  compiled: CompiledPlan,
  metricFragments: Array<{ name: string; fragment: string }>,
  options: RunQueryOptions,
): Promise<RunQueryOutcome> {
  let estimatedRows: number | null = null;
  if (!options.skipExplain) {
    try {
      const explained = await connector.explain(compiled.sql, compiled.params);
      estimatedRows = estimateExplainRows(explained);
    } catch (error) {
      return { status: 'db_error', phase: 'explain', code: (error as { code?: string })?.code ?? 'unknown', message: error instanceof Error ? error.message : String(error) };
    }
    const threshold = options.explainRowThreshold ?? EXPLAIN_ROW_THRESHOLD;
    if (estimatedRows !== null && estimatedRows > threshold) return { status: 'too_many_rows', estimatedRows };
  }

  let result: QueryResult;
  let checkResults: Array<{ label: string; result?: QueryResult; error?: string }>;
  try {
    const [main, ...checks] = await Promise.all([
      connector.query(compiled.sql, compiled.params, { maxRows: options.maxRows, signal: options.signal, timeoutMs: options.timeoutMs }),
      ...compiled.selfChecks.map((check) =>
        connector
          .query(check.sql, check.params, { maxRows: 1, signal: options.signal, timeoutMs: options.timeoutMs })
          .then((value) => ({ label: check.label, result: value }))
          .catch((error: unknown) => ({ label: check.label, error: error instanceof Error ? error.message : String(error) })),
      ),
    ]);
    result = main;
    checkResults = checks;
  } catch (error) {
    return { status: 'db_error', phase: 'query', code: (error as { code?: string })?.code ?? 'unknown', message: error instanceof Error ? error.message : String(error) };
  }

  const checks = evaluateSelfChecks(compiled, metricFragments, result, checkResults);
  if (checks.failed) return { status: 'check_failed', result, estimatedRows, checks };
  return { status: 'ok', result, estimatedRows, checks };
}
