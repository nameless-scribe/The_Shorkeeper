/**
 * 数据工具共用的依赖入口：数据源、字典、连接器、查询记录。
 * 全部可注入，测试用假实现；生产走仓储与连接缓存。
 */
import type { DataDictionary, ColumnManual, TableManual } from '../../datasources/dictionary';
import type { MysqlConnector } from '../../datasources/mysql-connector';
import { getConnectorForSource } from '../../datasources/connector-registry';
import { loadDictionary, updateColumnManual, updateTableManual } from '../../datasources/dictionary-store';
import {
  finishQueryRun,
  getDataSource,
  getQueryRunByArtifactPath,
  listDataSources,
  listNamedQueries,
  listNamedQueryEmbeddings,
  saveNamedQuery,
  startQueryRun,
  touchNamedQueryRun,
  upsertMetric,
  type DataSourceInfo,
  type NamedQueryInfo,
  type QueryRunInfo,
} from '../../db/repositories/datasources';
import type { NamedQueryCandidate } from '../../datasources/named-queries';
import { embedText } from '../../rag/embedding';
import { getEmbeddingConfigSafe } from '../../models/embedding-config';
import { createLinkedTimeoutSignal } from '../../agent/abort';

export const QUESTION_EMBED_TIMEOUT_MS = 10_000;

export interface DataToolDeps {
  listSources(): DataSourceInfo[];
  getSource(id: string): DataSourceInfo | null;
  loadDictionary(sourceId: string): DataDictionary;
  getConnector(sourceId: string): Pick<MysqlConnector, 'explain' | 'query'>;
  upsertMetric(input: { sourceId: string; name: string; sqlFragment: string; grain?: string | null; notes?: string | null; source: 'user' | 'query' }): void;
  updateTableManual(sourceId: string, table: string, patch: Partial<TableManual>): DataDictionary;
  updateColumnManual(sourceId: string, table: string, column: string, patch: Partial<ColumnManual>): DataDictionary;
  startQueryRun(input: { runId?: string | null; sourceId: string; planJson: string; sql: string }): QueryRunInfo | null;
  finishQueryRun(id: string, outcome: Parameters<typeof finishQueryRun>[1]): void;
  /** 该数据源的命名查询（带向量，没有就 null） */
  listNamedQueries(sourceId: string): NamedQueryCandidate[];
  saveNamedQuery(input: { id?: string; sourceId: string; name: string; question: string; planJson: string; sql: string; notes: string | null; embedding: Float32Array | null }): NamedQueryInfo;
  /** 没配嵌入模型或失败时返回 null，不影响流程 */
  embedQuestion(question: string, signal?: AbortSignal): Promise<Float32Array | null>;
  touchNamedQueryRun(id: string, rowCount: number): void;
  /** 导出用：按 CSV 路径找回那次查询 */
  getQueryRunByArtifact(artifactPath: string): QueryRunInfo | null;
  now(): Date;
}

function namedQueryCandidates(sourceId: string): NamedQueryCandidate[] {
  const embeddings = new Map(listNamedQueryEmbeddings(sourceId).map((item) => [item.id, item.embedding]));
  return listNamedQueries(sourceId).map((item) => ({
    id: item.id,
    name: item.name,
    question: item.question,
    planJson: item.planJson,
    notes: item.notes,
    embedding: embeddings.get(item.id) ?? null,
  }));
}

async function embedQuestionSafely(question: string, signal?: AbortSignal): Promise<Float32Array | null> {
  if (!getEmbeddingConfigSafe()) return null;
  const timeout = createLinkedTimeoutSignal(signal, QUESTION_EMBED_TIMEOUT_MS);
  try {
    const vector = await embedText(question, timeout.signal);
    return Float32Array.from(vector);
  } catch {
    return null;
  } finally {
    timeout.dispose();
  }
}

const productionDeps: DataToolDeps = {
  listSources: () => listDataSources(),
  getSource: (id) => getDataSource(id),
  loadDictionary: (sourceId) => loadDictionary(sourceId),
  getConnector: (sourceId) => getConnectorForSource(sourceId),
  upsertMetric: (input) => {
    upsertMetric(input);
  },
  updateTableManual: (sourceId, table, patch) => updateTableManual(sourceId, table, patch),
  updateColumnManual: (sourceId, table, column, patch) => updateColumnManual(sourceId, table, column, patch),
  startQueryRun: (input) => {
    try {
      return startQueryRun(input);
    } catch {
      return null;
    }
  },
  finishQueryRun: (id, outcome) => {
    try {
      finishQueryRun(id, outcome);
    } catch {
      // 记录失败不影响结果本身
    }
  },
  listNamedQueries: (sourceId) => namedQueryCandidates(sourceId),
  saveNamedQuery: (input) => saveNamedQuery(input),
  embedQuestion: (question, signal) => embedQuestionSafely(question, signal),
  touchNamedQueryRun: (id, rowCount) => {
    try {
      touchNamedQueryRun(id, rowCount);
    } catch {
      // 记录失败不影响结果
    }
  },
  getQueryRunByArtifact: (artifactPath) => {
    try {
      return getQueryRunByArtifactPath(artifactPath);
    } catch {
      return null;
    }
  },
  now: () => new Date(),
};

let deps: DataToolDeps = productionDeps;

export function getDataToolDeps(): DataToolDeps {
  return deps;
}

/** 测试用：整体替换或部分覆盖；传 null 恢复生产实现 */
export function setDataToolDeps(override: Partial<DataToolDeps> | null): void {
  deps = override ? { ...productionDeps, ...override } : productionDeps;
}

export const NO_SOURCE_MESSAGE = '尚未配置数据源，请到 设置 → 数据源 添加并测试连接；在此之前不要猜数据';

/** 按 id 或名称找数据源；只有一个时可省略 */
export function resolveSource(ref: string | undefined, current: DataToolDeps = deps): { source: DataSourceInfo } | { error: string } {
  const sources = current.listSources();
  if (!sources.length) return { error: NO_SOURCE_MESSAGE };
  const wanted = ref?.trim();
  if (!wanted) {
    if (sources.length === 1) return { source: sources[0] };
    return { error: `有 ${sources.length} 个数据源，请指定 source：${sources.map((item) => item.name).join(' / ')}` };
  }
  const found = sources.find((item) => item.id === wanted) ?? sources.find((item) => item.name === wanted)
    ?? sources.find((item) => item.name.toLowerCase() === wanted.toLowerCase());
  if (!found) return { error: `没有叫「${wanted}」的数据源；现有：${sources.map((item) => item.name).join(' / ')}` };
  return { source: found };
}

export const TIME_PRESETS = ['今天', '昨天', '本周', '上周', '本月', '上月', '今年', '去年', '最近7天', '最近30天'] as const;

/** 相对时间 → 左闭右开的 ISO 日期区间；定时重跑与 run_named_query 用 */
export function resolveTimePreset(preset: string, now: Date): { from: string; to: string } | null {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const shift = (days: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
  const weekday = (today.getDay() + 6) % 7;
  const weekStart = shift(-weekday);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  switch (preset.replace(/\s+/g, '')) {
    case '今天': return { from: iso(today), to: iso(shift(1)) };
    case '昨天': return { from: iso(shift(-1)), to: iso(today) };
    case '本周': return { from: iso(weekStart), to: iso(new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 7)) };
    case '上周': return { from: iso(new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() - 7)), to: iso(weekStart) };
    case '本月': return { from: iso(monthStart), to: iso(new Date(today.getFullYear(), today.getMonth() + 1, 1)) };
    case '上月': return { from: iso(new Date(today.getFullYear(), today.getMonth() - 1, 1)), to: iso(monthStart) };
    case '今年': return { from: iso(new Date(today.getFullYear(), 0, 1)), to: iso(new Date(today.getFullYear() + 1, 0, 1)) };
    case '去年': return { from: iso(new Date(today.getFullYear() - 1, 0, 1)), to: iso(new Date(today.getFullYear(), 0, 1)) };
    case '最近7天': return { from: iso(shift(-6)), to: iso(shift(1)) };
    case '最近30天': return { from: iso(shift(-29)), to: iso(shift(1)) };
    default: return null;
  }
}

function iso(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 给模型的日期锚点：今天、本周、本月、上月、今年（左闭右开），免得它猜错年份 */
export function describeDateContext(now: Date): string {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const weekday = (today.getDay() + 6) % 7; // 周一 = 0
  const weekStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - weekday);
  const weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 7);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const yearStart = new Date(today.getFullYear(), 0, 1);
  const nextYear = new Date(today.getFullYear() + 1, 0, 1);
  // 含今天的 30 天
  const last30 = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29);
  const names = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  return [
    `今天是 ${iso(today)}（${names[weekday]}）。时间范围一律左闭右开（from 含、to 不含）：`,
    `今天 ${iso(today)} ~ ${iso(tomorrow)}；昨天 ${iso(yesterday)} ~ ${iso(today)}；本周 ${iso(weekStart)} ~ ${iso(weekEnd)}；`,
    `本月 ${iso(monthStart)} ~ ${iso(nextMonth)}；上月 ${iso(lastMonth)} ~ ${iso(monthStart)}；最近 30 天 ${iso(last30)} ~ ${iso(tomorrow)}；今年 ${iso(yearStart)} ~ ${iso(nextYear)}`,
  ].join('');
}
