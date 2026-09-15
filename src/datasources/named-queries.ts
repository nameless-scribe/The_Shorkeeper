/**
 * 命名查询（P7.3，计划 §3.6、§11.4）：存做法不存结果。
 * 保存时把方案里的时间范围与过滤值抽成槽位（模板 + 示例槽位值），复用时槽位一律取自当前问题；
 * 相似检索先用向量（余弦 ≥ 0.80），没有向量时退化为字符二元组相似度。纯函数，不连库。
 */
import { renderQueryPlan } from './plan-render';
import type { DataDictionary } from './dictionary';
import type { PlanFilter, QueryPlan } from './query-plan';
import { cosineSimilarity } from '../rag/vector';
import { similarity } from './value-locator';

export const TIME_FROM_SLOT = '{{time_from}}';
export const TIME_TO_SLOT = '{{time_to}}';
export const NAMED_QUERY_VECTOR_THRESHOLD = 0.8;
export const NAMED_QUERY_KEYWORD_THRESHOLD = 0.35;
export const NAMED_QUERY_MAX_EXAMPLES = 3;

export interface NamedQuerySlots {
  timeRange?: { from: string; to: string };
  /** 与模板 filters 顺序一致 */
  filterValues: string[][];
}

/** 方案模板：与 QueryPlan 同形，但时间范围与过滤值是占位符 */
export interface NamedQueryTemplate extends Omit<QueryPlan, 'timeRange' | 'filters' | 'unresolved'> {
  timeRange?: { column: string; from: typeof TIME_FROM_SLOT; to: typeof TIME_TO_SLOT };
  filters: Array<Omit<PlanFilter, 'values'> & { values: string[] }>;
}

export interface NamedQueryPayload {
  version: 1;
  template: NamedQueryTemplate;
  /** 保存时的槽位值，只作示例展示，复用时不作为默认来源 */
  exampleSlots: NamedQuerySlots;
}

function filterSlot(index: number, position: number): string {
  return `{{filter_${index}_${position}}}`;
}

/** 字面量参数化：时间范围与过滤值抽成槽位 */
export function parameterizePlan(plan: QueryPlan): NamedQueryPayload {
  const { unresolved: _unresolved, timeRange, filters, ...rest } = plan;
  const template: NamedQueryTemplate = {
    ...rest,
    filters: filters.map((filter, index) => ({
      column: filter.column,
      op: filter.op,
      values: filter.values.map((_value, position) => filterSlot(index, position)),
    })),
    ...(timeRange ? { timeRange: { column: timeRange.column, from: TIME_FROM_SLOT, to: TIME_TO_SLOT } } : {}),
  };
  return {
    version: 1,
    template,
    exampleSlots: {
      ...(timeRange ? { timeRange: { from: timeRange.from, to: timeRange.to } } : {}),
      filterValues: filters.map((filter) => [...filter.values]),
    },
  };
}

/** 用槽位值把模板还原成可执行方案（P7.5 定时重跑、示例渲染用） */
export function instantiateTemplate(template: NamedQueryTemplate, slots: NamedQuerySlots): QueryPlan {
  const filters: PlanFilter[] = template.filters.map((filter, index) => ({
    column: filter.column,
    op: filter.op,
    values: slots.filterValues[index] ?? filter.values,
  }));
  const timeRange = template.timeRange && slots.timeRange
    ? { column: template.timeRange.column, from: slots.timeRange.from, to: slots.timeRange.to }
    : undefined;
  const { timeRange: _t, filters: _f, ...rest } = template;
  return { ...rest, filters, unresolved: [], ...(timeRange ? { timeRange } : {}) };
}

export function parseNamedQueryPayload(raw: string): NamedQueryPayload | null {
  try {
    const value = JSON.parse(raw) as Partial<NamedQueryPayload>;
    if (value && value.version === 1 && value.template && value.exampleSlots) return value as NamedQueryPayload;
  } catch {
    // 旧格式或损坏：当没有模板处理
  }
  return null;
}

/** 方案的形状：去掉字面量后的模板 JSON。形状相同 = 指标、粒度、连接、过滤的种类都一样 */
export function planShapeKey(plan: QueryPlan): string {
  const { template } = parameterizePlan(plan);
  const { limit: _limit, orderBy: _orderBy, ...shape } = template;
  return JSON.stringify(shape);
}

/** 所有槽位值也一样（§3.6 第 4 条：才允许跳过确认） */
export function sameSlots(a: QueryPlan, b: QueryPlan): boolean {
  if (planShapeKey(a) !== planShapeKey(b)) return false;
  const sa = parameterizePlan(a).exampleSlots;
  const sb = parameterizePlan(b).exampleSlots;
  return JSON.stringify(sa) === JSON.stringify(sb) && a.limit === b.limit && JSON.stringify(a.orderBy ?? null) === JSON.stringify(b.orderBy ?? null);
}

export interface NamedQueryCandidate {
  id: string;
  name: string;
  question: string;
  planJson: string;
  notes: string | null;
  embedding?: Float32Array | null;
}

export interface NamedQueryMatch {
  query: NamedQueryCandidate;
  score: number;
  by: 'vector' | 'keyword';
}

/** 相似检索：有向量按余弦，否则按字符二元组；各自阈值，取前 3 */
export function findSimilarNamedQueries(
  candidates: NamedQueryCandidate[],
  question: string,
  questionEmbedding: Float32Array | null,
  max = NAMED_QUERY_MAX_EXAMPLES,
): NamedQueryMatch[] {
  const matches: NamedQueryMatch[] = [];
  for (const candidate of candidates) {
    if (questionEmbedding && candidate.embedding && candidate.embedding.length === questionEmbedding.length) {
      const score = cosineSimilarity(questionEmbedding, candidate.embedding);
      if (score >= NAMED_QUERY_VECTOR_THRESHOLD) matches.push({ query: candidate, score, by: 'vector' });
      continue;
    }
    const score = similarity(candidate.question, question);
    if (score >= NAMED_QUERY_KEYWORD_THRESHOLD) matches.push({ query: candidate, score, by: 'keyword' });
  }
  return matches.sort((a, b) => b.score - a.score).slice(0, max);
}

/** 给模型看的示例：问题、做法（业务语言，用保存时的槽位值举例）；明确槽位按当前问题填 */
export function describeNamedQueryExample(candidate: NamedQueryCandidate, dictionary: DataDictionary): string {
  const payload = parseNamedQueryPayload(candidate.planJson);
  const parts = [`问题「${candidate.question}」→ 命名查询「${candidate.name}」`];
  if (payload) {
    const example = instantiateTemplate(payload.template, payload.exampleSlots);
    parts.push(`做法示例：${renderQueryPlan(example, dictionary).summary}`);
  }
  if (candidate.notes) parts.push(`口径说明：${candidate.notes}`);
  return parts.join('；');
}

/** 找到与当前方案形状相同的命名查询；同时报告槽位是否也全同 */
export function matchNamedQuery(plan: QueryPlan, candidates: NamedQueryCandidate[]): { query: NamedQueryCandidate; identical: boolean } | null {
  const shape = planShapeKey(plan);
  for (const candidate of candidates) {
    const payload = parseNamedQueryPayload(candidate.planJson);
    if (!payload) continue;
    const example = instantiateTemplate(payload.template, payload.exampleSlots);
    if (planShapeKey(example) !== shape) continue;
    return { query: candidate, identical: sameSlots(example, plan) };
  }
  return null;
}
