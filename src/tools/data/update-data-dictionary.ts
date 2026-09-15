/**
 * update_data_dictionary（P7.2，计划 §3.9）：把用户确认过的口径写进字典——指标、表 / 列的业务名与说明、枚举含义、时间基准列。
 * 只在用户点头之后调用；本机 upsert，可在设置页改回。
 */
import type { ToolDefinition, ToolResult } from '../types';
import { LOCAL_UPSERT_CONTRACT } from '../contract';
import { isSqlIdentifier } from '../../datasources/query-plan';
import { getDataToolDeps, resolveSource } from './source-access';

const FRAGMENT_FORBIDDEN = /;|--|\/\*|\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|call|load|outfile|into)\b/i;
export const MAX_DICTIONARY_ITEMS = 50;

function invalid(error: string): ToolResult {
  return { success: false, output: '', error, errorCategory: 'invalid_arguments' };
}

function text(value: unknown, label: string, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error(`${label}须为字符串`);
  const trimmed = value.trim();
  if ([...trimmed].length > max) throw new Error(`${label}过长（上限 ${max} 字）`);
  return trimmed;
}

interface MetricInput { name: string; sql_fragment: string; grain?: string; notes?: string }
interface TableInput { table: string; business_name?: string; description?: string; time_column?: string; is_source?: boolean }
interface ColumnInput { table: string; column: string; business_name?: string; description?: string; enum_values?: Record<string, string> }

export const updateDataDictionaryTool: ToolDefinition = {
  name: 'update_data_dictionary',
  description:
    '把用户确认过的口径写进数据字典：指标（名称 + 聚合表达式，事实表用别名 f）、表 / 列的业务名与说明、枚举含义、时间基准列。只在用户明确确认后调用',
  category: 'doc',
  requiresPermission: [],
  sideEffects: LOCAL_UPSERT_CONTRACT,
  parameters: {
    type: 'object',
    properties: {
      source: { type: 'string', description: '数据源名称或 id；只有一个时可省略' },
      metrics: {
        type: 'array',
        description: '指标定义',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '指标名，如 销售额' },
            sql_fragment: { type: 'string', description: '聚合表达式，如 SUM(f.paid_amount - f.refund_amount)；只能是表达式' },
            grain: { type: 'string', description: '粒度说明，如 订单 / 客户 / 日' },
            notes: { type: 'string', description: '口径说明：含税、扣退款、剔除测试账号等' },
          },
          required: ['name', 'sql_fragment'],
        },
      },
      tables: {
        type: 'array',
        description: '表的人工层',
        items: {
          type: 'object',
          properties: {
            table: { type: 'string' },
            business_name: { type: 'string' },
            description: { type: 'string' },
            time_column: { type: 'string', description: '事实表的时间基准列（物理列名）' },
            is_source: { type: 'boolean', description: '同类表里指明这张是真源' },
          },
          required: ['table'],
        },
      },
      columns: {
        type: 'array',
        description: '列的人工层',
        items: {
          type: 'object',
          properties: {
            table: { type: 'string' },
            column: { type: 'string' },
            business_name: { type: 'string' },
            description: { type: 'string' },
            enum_values: { type: 'object', description: '枚举含义，如 {"1": "待付款", "2": "已付款"}' },
          },
          required: ['table', 'column'],
        },
      },
    },
  },
  async execute(args) {
    const { source: ref, metrics, tables, columns } = (args ?? {}) as { source?: string; metrics?: MetricInput[]; tables?: TableInput[]; columns?: ColumnInput[] };
    const deps = getDataToolDeps();
    const resolved = resolveSource(ref, deps);
    if ('error' in resolved) return invalid(resolved.error);
    const source = resolved.source;
    const total = (metrics?.length ?? 0) + (tables?.length ?? 0) + (columns?.length ?? 0);
    if (!total) return invalid('没有要写的内容：metrics、tables、columns 至少给一个');
    if (total > MAX_DICTIONARY_ITEMS) return invalid(`一次最多写 ${MAX_DICTIONARY_ITEMS} 项`);
    const dictionary = deps.loadDictionary(source.id);
    const done: string[] = [];
    try {
      for (const item of metrics ?? []) {
        const name = text(item?.name, '指标名', 100);
        const fragment = text(item?.sql_fragment, 'SQL 片段', 2_000);
        if (!name || !fragment) throw new Error('指标要有 name 与 sql_fragment');
        if (FRAGMENT_FORBIDDEN.test(fragment)) throw new Error(`指标「${name}」的片段只能是聚合表达式，不能含分号、注释或写操作`);
        deps.upsertMetric({ sourceId: source.id, name, sqlFragment: fragment, grain: text(item.grain, '粒度', 50) ?? null, notes: text(item.notes, '口径说明', 500) ?? null, source: 'query' });
        done.push(`指标「${name}」`);
      }
      for (const item of tables ?? []) {
        const table = text(item?.table, '表名', 64);
        if (!table || !isSqlIdentifier(table) || !dictionary.tables[table]) throw new Error(`字典里没有表 ${item?.table ?? ''}`);
        const patch: Record<string, unknown> = {};
        const businessName = text(item.business_name, '业务名', 100);
        if (businessName !== undefined) patch.businessName = businessName;
        const description = text(item.description, '说明', 500);
        if (description !== undefined) patch.description = description;
        const timeColumn = text(item.time_column, '时间基准列', 64);
        if (timeColumn !== undefined) {
          if (timeColumn && !dictionary.tables[table].auto.columns.some((column) => column.name === timeColumn)) throw new Error(`表 ${table} 没有列 ${timeColumn}`);
          patch.timeColumn = timeColumn;
        }
        if (item.is_source !== undefined) {
          if (typeof item.is_source !== 'boolean') throw new Error('is_source 须为布尔值');
          patch.isSource = item.is_source;
        }
        if (!Object.keys(patch).length) throw new Error(`表 ${table} 没有要改的字段`);
        deps.updateTableManual(source.id, table, patch);
        done.push(`表「${businessName ?? table}」`);
      }
      for (const item of columns ?? []) {
        const table = text(item?.table, '表名', 64);
        const column = text(item?.column, '列名', 64);
        if (!table || !column || !isSqlIdentifier(table) || !isSqlIdentifier(column)) throw new Error('列条目要有合法的 table 与 column');
        if (!dictionary.tables[table]?.auto.columns.some((entry) => entry.name === column)) throw new Error(`字典里没有列 ${table}.${column}`);
        const patch: Record<string, unknown> = {};
        const businessName = text(item.business_name, '业务名', 100);
        if (businessName !== undefined) patch.businessName = businessName;
        const description = text(item.description, '说明', 500);
        if (description !== undefined) patch.description = description;
        if (item.enum_values !== undefined) {
          if (!item.enum_values || typeof item.enum_values !== 'object' || Array.isArray(item.enum_values)) throw new Error('enum_values 须为对象');
          const entries = Object.entries(item.enum_values);
          if (entries.length > 200) throw new Error('枚举值最多 200 个');
          patch.enumValues = Object.fromEntries(entries.map(([key, meaning]) => [key, String(text(meaning, `枚举 ${key} 的含义`, 40) ?? '')]));
        }
        if (!Object.keys(patch).length) throw new Error(`列 ${table}.${column} 没有要改的字段`);
        deps.updateColumnManual(source.id, table, column, patch);
        done.push(`列「${businessName ?? `${table}.${column}`}」`);
      }
    } catch (error) {
      return invalid(`${error instanceof Error ? error.message : String(error)}${done.length ? `（已写入：${done.join('、')}）` : ''}`);
    }
    return { success: true, output: `已写入字典：${done.join('、')}。之后的方案直接按这些口径算`, metadata: { sourceId: source.id, written: done.length } };
  },
};
