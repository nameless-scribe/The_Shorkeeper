/**
 * 数据字典与指标（P7.0，计划 §3.1、§3.2）。
 *
 * 骨架（auto）由连接层抓取，人工层（manual）由用户与确认过的查询逐步补全，两者分开存，
 * 刷新结构时人工层不丢。这里只有数据结构、合并与格式化，不连库。
 */

export type JoinCardinality = 'N:1' | '1:1' | '1:N';

export interface ColumnSkeleton {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  /** 前 3 个非空样例值，文本截断 40 字；只进字典缓存，不进日志与运行记录 */
  samples: string[];
  /** MySQL COLUMN_COMMENT，作为业务名的初始值 */
  comment?: string;
}

export interface TableSkeleton {
  name: string;
  columns: ColumnSkeleton[];
  rowCountEstimate?: number;
  comment?: string;
  foreignKeys: Array<{ column: string; refTable: string; refColumn: string }>;
}

export interface DictionaryJoin {
  /** 方案里引用的 id，形如 `orders.customer_id->customers.id` */
  id: string;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  cardinality: JoinCardinality;
}

export interface TableManual {
  businessName?: string;
  description?: string;
  /** 同一业务有多张表时指明该用哪张 */
  isSource?: boolean;
  /** 事实表必填 */
  timeColumn?: string;
  focused?: boolean;
  joins: DictionaryJoin[];
}

export interface ColumnManual {
  businessName?: string;
  description?: string;
  /** 枚举值含义：{ '1': '待付款', '2': '已付款' } */
  enumValues?: Record<string, string>;
  /** 枚举型文本列的取值表（去重值 ≤ 200），用于值定位 */
  knownValues?: string[];
}

export interface DictionaryTable {
  auto: TableSkeleton;
  manual: TableManual;
  columns: Record<string, ColumnManual>;
}

export type MetricSource = 'user' | 'query';

export interface MetricDefinition {
  name: string;
  /** 如 SUM(f.paid_amount - f.refund_amount)；引用事实表用别名 f */
  sqlFragment: string;
  grain?: string;
  notes?: string;
  source: MetricSource;
}

export interface DataDictionary {
  sourceId: string;
  tables: Record<string, DictionaryTable>;
  metrics: MetricDefinition[];
}

export const SAMPLE_MAX_CHARS = 40;
export const SAMPLE_MAX_COUNT = 3;
export const KNOWN_VALUES_MAX = 200;
/** 超过这么多关注表就不整份注入，改用检索挑表 */
export const CATALOG_MAX_TABLES = 60;

export function emptyManual(): TableManual {
  return { joins: [] };
}

export function truncateSample(value: string, max = SAMPLE_MAX_CHARS): string {
  const chars = [...value.replace(/\s+/g, ' ').trim()];
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max).join('')}…`;
}

/** 把抓取到的骨架与已有人工层合并：骨架整份替换，人工层只保留仍然存在的表列。 */
export function mergeSkeleton(
  sourceId: string,
  skeleton: TableSkeleton[],
  previous?: DataDictionary,
): DataDictionary {
  const tables: Record<string, DictionaryTable> = {};
  for (const table of skeleton) {
    const prior = previous?.tables[table.name];
    const columnNames = new Set(table.columns.map((column) => column.name));
    const columns: Record<string, ColumnManual> = {};
    for (const [name, manual] of Object.entries(prior?.columns ?? {})) {
      if (columnNames.has(name)) columns[name] = manual;
    }
    const manual: TableManual = prior?.manual ? { ...prior.manual } : emptyManual();
    // 表注释是业务名的初始值：人工没填时才用
    if (!manual.businessName && table.comment?.trim()) manual.businessName = truncateSample(table.comment, 30);
    for (const column of table.columns) {
      if (!columns[column.name]?.businessName && column.comment?.trim()) {
        columns[column.name] = { ...(columns[column.name] ?? {}), businessName: truncateSample(column.comment, 30) };
      }
    }
    // 外键自动生成 N:1 连接建议；人工层已有同 id 的不重复
    const joins = [...manual.joins];
    for (const fk of table.foreignKeys) {
      const id = joinId(table.name, fk.column, fk.refTable, fk.refColumn);
      if (!joins.some((join) => join.id === id)) {
        joins.push({ id, fromTable: table.name, fromColumn: fk.column, toTable: fk.refTable, toColumn: fk.refColumn, cardinality: 'N:1' });
      }
    }
    manual.joins = joins;
    tables[table.name] = {
      auto: {
        ...table,
        columns: table.columns.map((column) => ({
          ...column,
          samples: column.samples.slice(0, SAMPLE_MAX_COUNT).map((sample) => truncateSample(sample)),
        })),
      },
      manual,
      columns,
    };
  }
  return { sourceId, tables, metrics: previous?.metrics ?? [] };
}

export function joinId(fromTable: string, fromColumn: string, toTable: string, toColumn: string): string {
  return `${fromTable}.${fromColumn}->${toTable}.${toColumn}`;
}

export function findJoin(dictionary: DataDictionary, id: string): DictionaryJoin | undefined {
  for (const table of Object.values(dictionary.tables)) {
    const join = table.manual.joins.find((item) => item.id === id);
    if (join) return join;
  }
  return undefined;
}

export function tableBusinessName(dictionary: DataDictionary, table: string): string | undefined {
  const entry = dictionary.tables[table];
  return entry?.manual.businessName?.trim() || entry?.manual.description?.trim() || undefined;
}

export function columnBusinessName(dictionary: DataDictionary, table: string, column: string): string | undefined {
  const entry = dictionary.tables[table]?.columns[column];
  return entry?.businessName?.trim() || entry?.description?.trim() || undefined;
}

/** 枚举值的业务含义（'2' → '已付款'）；没有登记就原样返回 */
export function enumLabel(dictionary: DataDictionary, table: string, column: string, value: string): string {
  return dictionary.tables[table]?.columns[column]?.enumValues?.[value] ?? value;
}

export function findMetric(dictionary: DataDictionary, name: string): MetricDefinition | undefined {
  const wanted = name.trim();
  return dictionary.metrics.find((metric) => metric.name === wanted);
}

export function focusedTables(dictionary: DataDictionary): string[] {
  const all = Object.keys(dictionary.tables);
  const focused = all.filter((name) => dictionary.tables[name].manual.focused);
  return focused.length ? focused : all;
}

/**
 * 表清单：每张表一行（业务名、物理名、一句话、行数、是否真源）。
 * 这是 describe_data_source 的第一层；超过 CATALOG_MAX_TABLES 时只给前 N 张并注明需检索。
 */
export function formatTableCatalog(dictionary: DataDictionary, options: { max?: number } = {}): string {
  const max = options.max ?? CATALOG_MAX_TABLES;
  const names = focusedTables(dictionary);
  const lines = names.slice(0, max).map((name) => {
    const table = dictionary.tables[name];
    const business = table.manual.businessName?.trim();
    const parts = [business ? `${business}（${name}）` : name];
    if (table.manual.description?.trim()) parts.push(table.manual.description.trim());
    if (table.manual.isSource) parts.push('真源');
    if (table.manual.timeColumn) parts.push(`时间基准 ${table.manual.timeColumn}`);
    if (typeof table.auto.rowCountEstimate === 'number') parts.push(`约 ${table.auto.rowCountEstimate} 行`);
    return `- ${parts.join('；')}`;
  });
  if (names.length > max) lines.push(`- …另有 ${names.length - max} 张表未列出，按问题检索后再取`);
  return lines.join('\n');
}

/** 单张表的列与字典条目，供模型按需取。 */
export function formatTableDetail(dictionary: DataDictionary, tableName: string): string | null {
  const table = dictionary.tables[tableName];
  if (!table) return null;
  const header = table.manual.businessName ? `${table.manual.businessName}（${tableName}）` : tableName;
  const lines = [`表 ${header}${table.manual.description ? `：${table.manual.description}` : ''}`];
  if (table.manual.timeColumn) lines.push(`时间基准列：${table.manual.timeColumn}`);
  for (const column of table.auto.columns) {
    const manual = table.columns[column.name];
    const parts = [`${column.name} ${column.type}${column.primaryKey ? ' 主键' : ''}`];
    if (manual?.businessName) parts.push(manual.businessName);
    if (manual?.description) parts.push(manual.description);
    if (manual?.enumValues && Object.keys(manual.enumValues).length) {
      parts.push(`枚举 ${Object.entries(manual.enumValues).map(([k, v]) => `${k}=${v}`).join(' ')}`);
    } else if (manual?.knownValues?.length) {
      parts.push(`取值 ${manual.knownValues.slice(0, 12).join(' / ')}${manual.knownValues.length > 12 ? ' …' : ''}`);
    } else if (column.samples.length) {
      parts.push(`样例 ${column.samples.join(' / ')}`);
    }
    lines.push(`- ${parts.join('；')}`);
  }
  if (table.manual.joins.length) {
    lines.push('连接：');
    for (const join of table.manual.joins) {
      const target = dictionary.tables[join.toTable]?.manual.businessName;
      lines.push(`- ${join.id}（${join.cardinality}${target ? `，${target}` : ''}）`);
    }
  }
  return lines.join('\n');
}

export function formatMetrics(dictionary: DataDictionary): string {
  if (!dictionary.metrics.length) return '（尚未定义指标；问题里的指标词先向用户确认口径）';
  return dictionary.metrics
    .map((metric) => {
      const parts = [metric.name];
      if (metric.grain) parts.push(`粒度 ${metric.grain}`);
      if (metric.notes) parts.push(metric.notes);
      parts.push(`片段 ${metric.sqlFragment}`);
      return `- ${parts.join('；')}`;
    })
    .join('\n');
}
