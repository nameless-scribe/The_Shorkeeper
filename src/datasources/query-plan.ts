/**
 * 查询方案（P7.0，计划 §11.1）：编译器与业务语言渲染器的唯一输入。
 * 模型只填槽位；校验在这里，与 `ipc-validation` 同一风格（手写、逐字段、报中文错误）。
 */

export type FilterOp = 'eq' | 'in' | 'neq' | 'gte' | 'lte' | 'like';
export type UnresolvedSlot = '指标' | '时间范围' | '粒度' | '范围过滤' | '排序数量';

export interface PlanDimension {
  table: string;
  /** 字典里的合法连接 id */
  join: string;
}

export interface PlanTimeRange {
  /** 事实表的时间基准列（物理列名，不带表名） */
  column: string;
  /** 左闭 */
  from: string;
  /** 右开 */
  to: string;
}

export interface PlanFilter {
  /** `表.列` */
  column: string;
  op: FilterOp;
  values: string[];
}

export interface PlanMetric {
  name: string;
  /** 来自指标定义的 SQL 片段；未定义的指标不得出现 */
  fragment: string;
}

export interface PlanUnresolved {
  slot: UnresolvedSlot;
  question: string;
  options?: string[];
}

export interface QueryPlan {
  sourceId: string;
  fact: { table: string };
  dimensions: PlanDimension[];
  timeRange?: PlanTimeRange;
  filters: PlanFilter[];
  /** 分组列，`表.列` */
  grain: string[];
  metrics: PlanMetric[];
  compare?: { kind: 'yoy' | 'mom' };
  orderBy?: { metric: string; direction: 'asc' | 'desc' };
  limit: number;
  unresolved: PlanUnresolved[];
  /** 逃生口：方案表达不了时模型直接写；有它则跳过编译器 */
  rawSql?: string;
}

export const PLAN_DEFAULT_LIMIT = 500;
export const PLAN_MAX_LIMIT = 5000;
export const PLAN_MAX_FILTER_VALUES = 200;

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const QUALIFIED = /^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?$/;
const FILTER_OPS: ReadonlySet<string> = new Set(['eq', 'in', 'neq', 'gte', 'lte', 'like']);
const SLOTS: ReadonlySet<string> = new Set(['指标', '时间范围', '粒度', '范围过滤', '排序数量']);

export function isSqlIdentifier(value: string): boolean {
  return IDENTIFIER.test(value);
}

export function isQualifiedColumn(value: string): boolean {
  return QUALIFIED.test(value);
}

export function splitQualifiedColumn(value: string): { table: string; column: string } {
  const [table, column] = value.split('.');
  return { table, column };
}

type Parsed = { plan: QueryPlan } | { error: string };

function fail(error: string): Parsed {
  return { error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 把模型给的对象校验成 QueryPlan；任何一处不合规都返回可读的错误，不做静默修补。 */
export function parseQueryPlan(value: unknown): Parsed {
  if (!isRecord(value)) return fail('方案必须是对象');

  const sourceId = typeof value.sourceId === 'string' ? value.sourceId.trim() : '';
  if (!sourceId) return fail('缺少 sourceId');

  if (!isRecord(value.fact) || typeof value.fact.table !== 'string' || !isSqlIdentifier(value.fact.table)) {
    return fail('fact.table 必须是合法表名');
  }
  const fact = { table: value.fact.table };

  const dimensions: PlanDimension[] = [];
  if (value.dimensions !== undefined) {
    if (!Array.isArray(value.dimensions)) return fail('dimensions 必须是数组');
    for (const item of value.dimensions) {
      if (!isRecord(item) || typeof item.table !== 'string' || !isSqlIdentifier(item.table)) {
        return fail('dimensions 每项须含合法的 table');
      }
      if (typeof item.join !== 'string' || !item.join.trim()) return fail(`维度 ${item.table} 缺少 join（字典里的连接 id）`);
      dimensions.push({ table: item.table, join: item.join.trim() });
    }
  }
  if (dimensions.length > 8) return fail('维度表最多 8 个');

  let timeRange: PlanTimeRange | undefined;
  if (value.timeRange !== undefined && value.timeRange !== null) {
    const range = value.timeRange;
    if (!isRecord(range) || typeof range.column !== 'string' || !isSqlIdentifier(range.column)) {
      return fail('timeRange.column 必须是事实表的列名');
    }
    if (typeof range.from !== 'string' || !ISO_DATE.test(range.from)) return fail('timeRange.from 须为 ISO 日期');
    if (typeof range.to !== 'string' || !ISO_DATE.test(range.to)) return fail('timeRange.to 须为 ISO 日期');
    if (range.from >= range.to) return fail('timeRange 必须 from < to（左闭右开）');
    timeRange = { column: range.column, from: range.from, to: range.to };
  }

  const filters: PlanFilter[] = [];
  if (value.filters !== undefined) {
    if (!Array.isArray(value.filters)) return fail('filters 必须是数组');
    for (const item of value.filters) {
      if (!isRecord(item) || typeof item.column !== 'string' || !isQualifiedColumn(item.column)) {
        return fail('filters 每项的 column 须为 表.列');
      }
      if (typeof item.op !== 'string' || !FILTER_OPS.has(item.op)) return fail(`过滤 ${item.column} 的 op 无效`);
      if (!Array.isArray(item.values) || !item.values.length) return fail(`过滤 ${item.column} 缺少 values`);
      if (item.values.length > PLAN_MAX_FILTER_VALUES) return fail(`过滤 ${item.column} 的值太多（上限 ${PLAN_MAX_FILTER_VALUES}）`);
      if (item.op !== 'in' && item.values.length !== 1) return fail(`过滤 ${item.column} 的 ${item.op} 只能有一个值`);
      const values = item.values.map((v) => (typeof v === 'number' ? String(v) : v));
      if (values.some((v) => typeof v !== 'string')) return fail(`过滤 ${item.column} 的值须为字符串`);
      filters.push({ column: item.column, op: item.op as FilterOp, values: values as string[] });
    }
  }
  if (filters.length > 20) return fail('过滤条件最多 20 个');

  const grain: string[] = [];
  if (value.grain !== undefined) {
    if (!Array.isArray(value.grain)) return fail('grain 必须是数组');
    for (const item of value.grain) {
      if (typeof item !== 'string' || !isQualifiedColumn(item)) return fail('grain 每项须为 表.列');
      if (!grain.includes(item)) grain.push(item);
    }
  }
  if (grain.length > 6) return fail('分组列最多 6 个');

  const metrics: PlanMetric[] = [];
  if (!Array.isArray(value.metrics)) return fail('metrics 必须是数组');
  const metricNames = new Set<string>();
  for (const item of value.metrics) {
    if (!isRecord(item) || typeof item.name !== 'string' || !item.name.trim()) return fail('metrics 每项须含 name');
    if (typeof item.fragment !== 'string' || !item.fragment.trim()) return fail(`指标 ${item.name} 缺少 fragment`);
    const name = item.name.trim();
    if (metricNames.has(name)) return fail(`指标重复：${name}`);
    metricNames.add(name);
    metrics.push({ name, fragment: item.fragment.trim() });
  }
  if (metrics.length > 10) return fail('指标最多 10 个');

  let compare: QueryPlan['compare'];
  if (value.compare !== undefined && value.compare !== null) {
    if (!isRecord(value.compare) || (value.compare.kind !== 'yoy' && value.compare.kind !== 'mom')) {
      return fail('compare.kind 只能是 yoy 或 mom');
    }
    compare = { kind: value.compare.kind };
  }

  let orderBy: QueryPlan['orderBy'];
  if (value.orderBy !== undefined && value.orderBy !== null) {
    const order = value.orderBy;
    if (!isRecord(order) || typeof order.metric !== 'string' || !metricNames.has(order.metric)) {
      return fail('orderBy.metric 必须是方案里的指标名');
    }
    if (order.direction !== 'asc' && order.direction !== 'desc') return fail('orderBy.direction 只能是 asc 或 desc');
    orderBy = { metric: order.metric, direction: order.direction };
  }

  let limit = PLAN_DEFAULT_LIMIT;
  if (value.limit !== undefined) {
    if (typeof value.limit !== 'number' || !Number.isFinite(value.limit)) return fail('limit 须为数字');
    limit = Math.floor(value.limit);
    if (limit < 1 || limit > PLAN_MAX_LIMIT) return fail(`limit 须在 1–${PLAN_MAX_LIMIT} 之间`);
  }

  const unresolved: PlanUnresolved[] = [];
  if (value.unresolved !== undefined) {
    if (!Array.isArray(value.unresolved)) return fail('unresolved 必须是数组');
    for (const item of value.unresolved) {
      if (!isRecord(item) || typeof item.slot !== 'string' || !SLOTS.has(item.slot)) return fail('unresolved 每项的 slot 无效');
      if (typeof item.question !== 'string' || !item.question.trim()) return fail('unresolved 每项须含 question');
      const options = Array.isArray(item.options) ? item.options.filter((o): o is string => typeof o === 'string' && !!o.trim()) : undefined;
      unresolved.push({ slot: item.slot as UnresolvedSlot, question: item.question.trim(), ...(options?.length ? { options } : {}) });
    }
  }

  let rawSql: string | undefined;
  if (value.rawSql !== undefined && value.rawSql !== null) {
    if (typeof value.rawSql !== 'string' || !value.rawSql.trim()) return fail('rawSql 须为非空字符串');
    rawSql = value.rawSql.trim();
  }

  if (!rawSql && !metrics.length) return fail('方案至少要有一个指标（或走 rawSql）');

  return {
    plan: {
      sourceId, fact, dimensions, filters, grain, metrics, limit, unresolved,
      ...(timeRange ? { timeRange } : {}),
      ...(compare ? { compare } : {}),
      ...(orderBy ? { orderBy } : {}),
      ...(rawSql ? { rawSql } : {}),
    },
  };
}

/** 方案是否可以直接执行：没有未确定项。 */
export function isPlanReady(plan: QueryPlan): boolean {
  return plan.unresolved.length === 0;
}
