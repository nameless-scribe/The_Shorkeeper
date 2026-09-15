/**
 * 方案编译器（P7.0，计划 §3.13.1、§11.2）：确定性地把查询方案编成只读 SQL。纯函数，不连库。
 *
 * 形状：一张事实表 + 若干维度表（按字典里的合法连接）+ 过滤 + 分组 + 指标 + 排序 + 上限 + 对比周期。
 * 保证：先按事实表粒度聚合成 CTE 再连维度（一对多连接不放大指标）；时间范围左闭右开；
 * 标识符全部反引号；字面量全部 `?` 参数；LIMIT 必加；只产生 SELECT。
 * 方案表达不了的形状明确拒绝，让模型走 rawSql 逃生口（那条路没有自检）。
 */

import { findJoin, findMetric, type DataDictionary, type DictionaryJoin } from './dictionary';
import { isSqlIdentifier, splitQualifiedColumn, type QueryPlan } from './query-plan';
import { validateReadOnlySql, wrapRawSql } from './sql-validator';

export interface CompiledSql {
  sql: string;
  params: Array<string | number>;
}

export interface CompiledPlan extends CompiledSql {
  /** 两条便宜的只读查询：整体合计（同过滤、无分组）与实际日期覆盖 */
  selfChecks: Array<{ label: string; sql: string; params: Array<string | number> }>;
  /** 结果列的顺序与含义 */
  columns: Array<{ name: string; kind: 'grain' | 'metric' | 'compare' }>;
  /** 走了逃生口：没有自检 */
  raw: boolean;
  warnings: string[];
}

export type CompileResult = { ok: true; compiled: CompiledPlan } | { ok: false; error: string };

const FACT_ALIAS = 'f';
const PREV_ALIAS = 'p';

function q(identifier: string): string {
  if (!isSqlIdentifier(identifier)) throw new Error(`非法标识符：${identifier}`);
  return `\`${identifier}\``;
}

function metricAlias(name: string, suffix = ''): string {
  // 指标名可能是中文，作为列别名用反引号包起来；反引号本身不允许出现
  if (name.includes('`')) throw new Error(`指标名不能含反引号：${name}`);
  return `\`${name}${suffix}\``;
}

/** 片段里对事实表的引用统一成别名 f：`orders.paid_amount` → `f`.`paid_amount` */
function normalizeFragment(fragment: string, factTable: string, alias: string): string {
  const escaped = factTable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return fragment
    .replace(new RegExp(`\\b${escaped}\\.`, 'g'), `${alias}.`)
    .replace(new RegExp(`\\b${FACT_ALIAS}\\.`, 'g'), `${alias}.`);
}

function shiftIsoDate(value: string, kind: 'yoy' | 'mom'): string {
  const [date, time] = value.split(/[T ]/);
  const [y, m, d] = date.split('-').map(Number);
  const shifted = kind === 'yoy' ? new Date(Date.UTC(y - 1, m - 1, d)) : new Date(Date.UTC(y, m - 2, d));
  const pad = (n: number) => String(n).padStart(2, '0');
  const iso = `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
  return time ? `${iso} ${time}` : iso;
}

interface FactCte {
  sql: string;
  params: Array<string | number>;
}

interface Resolved {
  dims: Array<{ table: string; alias: string; join: DictionaryJoin }>;
  factGrain: string[];
  dimGrain: Array<{ table: string; column: string; alias: string }>;
  /** CTE 里必须带上的事实表列：事实分组列 + 维度分组所需的连接键 */
  cteKeys: string[];
}

function resolve(plan: QueryPlan, dictionary: DataDictionary): Resolved | string {
  const fact = plan.fact.table;
  if (!dictionary.tables[fact]) return `字典里没有表 ${fact}`;
  const dims: Resolved['dims'] = [];
  const dimAliasByTable = new Map<string, string>();
  plan.dimensions.forEach((dimension, index) => {
    const join = findJoin(dictionary, dimension.join);
    if (!join) throw new Error(`连接 ${dimension.join} 不在字典里`);
    if (join.fromTable !== fact || join.toTable !== dimension.table) {
      throw new Error(`连接 ${dimension.join} 不是从 ${fact} 到 ${dimension.table} 的`);
    }
    if (join.cardinality === '1:N') throw new Error(`连接 ${dimension.join} 是一对多，不能作为维度连接`);
    if (!dictionary.tables[dimension.table]) throw new Error(`字典里没有表 ${dimension.table}`);
    const alias = `d${index + 1}`;
    dims.push({ table: dimension.table, alias, join });
    dimAliasByTable.set(dimension.table, alias);
  });

  const factGrain: string[] = [];
  const dimGrain: Resolved['dimGrain'] = [];
  const cteKeys = new Set<string>();
  for (const item of plan.grain) {
    const { table, column } = splitQualifiedColumn(item);
    if (table === fact) {
      factGrain.push(column);
      cteKeys.add(column);
    } else {
      const alias = dimAliasByTable.get(table);
      if (!alias) throw new Error(`分组列 ${item} 所在的表不在方案的维度里`);
      const dim = dims.find((d) => d.alias === alias)!;
      cteKeys.add(dim.join.fromColumn);
      dimGrain.push({ table, column, alias });
    }
  }
  if (plan.timeRange && !dictionary.tables[fact].auto.columns.some((c) => c.name === plan.timeRange!.column)) {
    throw new Error(`时间列 ${plan.timeRange.column} 不在事实表 ${fact} 上`);
  }
  for (const filter of plan.filters) {
    const { table } = splitQualifiedColumn(filter.column);
    if (table !== fact && !dimAliasByTable.has(table)) throw new Error(`过滤列 ${filter.column} 所在的表不在方案里`);
  }
  return { dims, factGrain, dimGrain, cteKeys: [...cteKeys] };
}

function factWhere(
  plan: QueryPlan,
  timeRange: { from: string; to: string } | undefined,
  alias: string,
): { clauses: string[]; params: Array<string | number> } {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (plan.timeRange && timeRange) {
    clauses.push(`${alias}.${q(plan.timeRange.column)} >= ? AND ${alias}.${q(plan.timeRange.column)} < ?`);
    params.push(timeRange.from, timeRange.to);
  }
  for (const filter of plan.filters) {
    const { table, column } = splitQualifiedColumn(filter.column);
    if (table !== plan.fact.table) continue;
    const clause = filterClause(`${alias}.${q(column)}`, filter.op, filter.values.length);
    clauses.push(clause);
    params.push(...filter.values);
  }
  return { clauses, params };
}

function filterClause(column: string, op: QueryPlan['filters'][number]['op'], count: number): string {
  switch (op) {
    case 'eq': return `${column} = ?`;
    case 'neq': return `${column} <> ?`;
    case 'gte': return `${column} >= ?`;
    case 'lte': return `${column} <= ?`;
    case 'like': return `${column} LIKE ?`;
    case 'in': return `${column} IN (${Array.from({ length: count }, () => '?').join(', ')})`;
    default: throw new Error(`不支持的过滤方式 ${op as string}`);
  }
}

function buildFactCte(
  plan: QueryPlan,
  resolved: Resolved,
  timeRange: { from: string; to: string } | undefined,
): FactCte {
  const fact = plan.fact.table;
  const keyCols = resolved.cteKeys.map((column) => `${FACT_ALIAS}.${q(column)} AS ${q(column)}`);
  const metricCols = plan.metrics.map((metric) => `${normalizeFragment(metric.fragment, fact, FACT_ALIAS)} AS ${metricAlias(metric.name)}`);
  const where = factWhere(plan, timeRange, FACT_ALIAS);
  const parts = [`SELECT ${[...keyCols, ...metricCols].join(', ')} FROM ${q(fact)} ${FACT_ALIAS}`];
  if (where.clauses.length) parts.push(`WHERE ${where.clauses.join(' AND ')}`);
  if (resolved.cteKeys.length) parts.push(`GROUP BY ${resolved.cteKeys.map((column) => `${FACT_ALIAS}.${q(column)}`).join(', ')}`);
  return { sql: parts.join(' '), params: where.params };
}

export function compileQueryPlan(plan: QueryPlan, dictionary: DataDictionary): CompileResult {
  if (plan.unresolved.length) return { ok: false, error: `方案还有未确定项：${plan.unresolved.map((u) => u.question).join('；')}` };

  if (plan.rawSql) {
    const validated = validateReadOnlySql(plan.rawSql, plan.limit);
    if (!validated.ok) return { ok: false, error: `自定义 SQL 未通过校验：${validated.error}` };
    return {
      ok: true,
      compiled: {
        sql: wrapRawSql(plan.rawSql, plan.limit),
        params: [],
        selfChecks: [],
        columns: [],
        raw: true,
        warnings: [...validated.warnings, '这个结果未经自动核对'],
      },
    };
  }

  try {
    const resolvedOrError = resolve(plan, dictionary);
    if (typeof resolvedOrError === 'string') return { ok: false, error: resolvedOrError };
    const resolved = resolvedOrError;
    for (const metric of plan.metrics) {
      // 指标片段来自指标定义；方案里给的片段必须与字典一致，防止模型自造口径
      const defined = findMetric(dictionary, metric.name);
      if (defined && defined.sqlFragment.trim() !== metric.fragment.trim()) {
        return { ok: false, error: `指标「${metric.name}」的口径与已定义的不一致，请用已定义的口径或先更新指标` };
      }
    }
    if (plan.compare && !plan.timeRange) return { ok: false, error: '同比 / 环比需要先给出时间范围' };

    const params: Array<string | number> = [];
    const ctes: string[] = [];
    const current = buildFactCte(plan, resolved, plan.timeRange);
    ctes.push(`${FACT_ALIAS} AS (${current.sql})`);
    params.push(...current.params);

    if (plan.compare && plan.timeRange) {
      const shifted = {
        from: shiftIsoDate(plan.timeRange.from, plan.compare.kind),
        to: shiftIsoDate(plan.timeRange.to, plan.compare.kind),
      };
      const previous = buildFactCte(plan, resolved, shifted);
      ctes.push(`${PREV_ALIAS} AS (${previous.sql.replace(new RegExp(`\\b${FACT_ALIAS}\\.`, 'g'), `${PREV_ALIAS}.`).replace(`${q(plan.fact.table)} ${FACT_ALIAS}`, `${q(plan.fact.table)} ${PREV_ALIAS}`)})`);
      params.push(...previous.params);
    }

    const columns: CompiledPlan['columns'] = [];
    const selectCols: string[] = [];
    for (const column of resolved.factGrain) {
      selectCols.push(`${FACT_ALIAS}.${q(column)} AS ${q(column)}`);
      columns.push({ name: column, kind: 'grain' });
    }
    for (const item of resolved.dimGrain) {
      selectCols.push(`${item.alias}.${q(item.column)} AS ${q(item.column)}`);
      columns.push({ name: item.column, kind: 'grain' });
    }
    for (const metric of plan.metrics) {
      if (plan.compare) {
        const cur = `${FACT_ALIAS}.${metricAlias(metric.name)}`;
        const prev = `${PREV_ALIAS}.${metricAlias(metric.name)}`;
        selectCols.push(
          `${cur} AS ${metricAlias(metric.name)}`,
          `${prev} AS ${metricAlias(metric.name, '_上期')}`,
          `(${cur} - ${prev}) AS ${metricAlias(metric.name, '_差值')}`,
          `((${cur} - ${prev}) / NULLIF(${prev}, 0)) AS ${metricAlias(metric.name, '_增幅')}`,
        );
        columns.push(
          { name: metric.name, kind: 'metric' },
          { name: `${metric.name}_上期`, kind: 'compare' },
          { name: `${metric.name}_差值`, kind: 'compare' },
          { name: `${metric.name}_增幅`, kind: 'compare' },
        );
      } else {
        selectCols.push(`${FACT_ALIAS}.${metricAlias(metric.name)} AS ${metricAlias(metric.name)}`);
        columns.push({ name: metric.name, kind: 'metric' });
      }
    }

    const joins: string[] = [];
    for (const dim of resolved.dims) {
      joins.push(`LEFT JOIN ${q(dim.table)} ${dim.alias} ON ${FACT_ALIAS}.${q(dim.join.fromColumn)} = ${dim.alias}.${q(dim.join.toColumn)}`);
    }
    if (plan.compare) {
      const keys = resolved.cteKeys.map((column) => `${FACT_ALIAS}.${q(column)} <=> ${PREV_ALIAS}.${q(column)}`);
      joins.push(`LEFT JOIN ${PREV_ALIAS} ON ${keys.length ? keys.join(' AND ') : '1 = 1'}`);
    }

    const outerWhere: string[] = [];
    for (const filter of plan.filters) {
      const { table, column } = splitQualifiedColumn(filter.column);
      if (table === plan.fact.table) continue;
      const dim = resolved.dims.find((d) => d.table === table)!;
      outerWhere.push(filterClause(`${dim.alias}.${q(column)}`, filter.op, filter.values.length));
      params.push(...filter.values);
    }

    const orderMetric = plan.orderBy?.metric ?? plan.metrics[0]?.name;
    const direction = plan.orderBy?.direction === 'asc' ? 'ASC' : 'DESC';
    const order = orderMetric ? ` ORDER BY ${FACT_ALIAS}.${metricAlias(orderMetric)} ${direction}` : '';

    const sql = `WITH ${ctes.join(', ')} SELECT ${selectCols.join(', ')} FROM ${FACT_ALIAS}${joins.length ? ` ${joins.join(' ')}` : ''}${outerWhere.length ? ` WHERE ${outerWhere.join(' AND ')}` : ''}${order} LIMIT ${plan.limit}`;

    const checked = validateReadOnlySql(sql, plan.limit);
    if (!checked.ok) return { ok: false, error: `编译结果未通过校验（编译器缺陷）：${checked.error}` };

    // 自检：整体合计（同过滤、无分组）与实际日期覆盖
    const totalWhere = factWhere(plan, plan.timeRange, FACT_ALIAS);
    const totalSql = `SELECT ${plan.metrics.map((metric) => `${normalizeFragment(metric.fragment, plan.fact.table, FACT_ALIAS)} AS ${metricAlias(metric.name)}`).join(', ')} FROM ${q(plan.fact.table)} ${FACT_ALIAS}${totalWhere.clauses.length ? ` WHERE ${totalWhere.clauses.join(' AND ')}` : ''} LIMIT 1`;
    const selfChecks: CompiledPlan['selfChecks'] = [{ label: '整体合计', sql: totalSql, params: totalWhere.params }];
    if (plan.timeRange) {
      const column = `${FACT_ALIAS}.${q(plan.timeRange.column)}`;
      selfChecks.push({
        label: '日期覆盖',
        sql: `SELECT MIN(${column}) AS \`最早\`, MAX(${column}) AS \`最晚\` FROM ${q(plan.fact.table)} ${FACT_ALIAS}${totalWhere.clauses.length ? ` WHERE ${totalWhere.clauses.join(' AND ')}` : ''} LIMIT 1`,
        params: totalWhere.params,
      });
    }

    return { ok: true, compiled: { sql: checked.sql, params, selfChecks, columns, raw: false, warnings: checked.warnings } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
