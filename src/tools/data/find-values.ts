/**
 * find_values（P7.3，计划 §3.13.2 后半）：没有取值表的高基数列（姓名、单号）按包含匹配探测取值。
 * 只读，最多 3 列、每列 1 秒、每列最多 6 个匹配；结果给模型用来把过滤写成精确值或让用户选。
 */
import type { ToolDefinition, ToolResult } from '../types';
import { READ_ONLY_CONTRACT } from '../contract';
import { columnBusinessName, type DataDictionary } from '../../datasources/dictionary';
import { quoteDatabaseName, quoteIdentifier } from '../../datasources/mysql-helpers';
import { isSqlIdentifier } from '../../datasources/query-plan';
import { getDataToolDeps, resolveSource } from './source-access';

export const FIND_VALUES_MAX_COLUMNS = 3;
export const FIND_VALUES_MAX_MATCHES = 6;
export const FIND_VALUES_TIMEOUT_MS = 1_000;

function invalid(error: string): ToolResult {
  return { success: false, output: '', error, errorCategory: 'invalid_arguments' };
}

const TEXT_TYPE = /^(var)?char|^(tiny|medium|long)?text/i;

/** 候选列：指定列，或表里没有取值表的文本列（有取值表的 propose_query_plan 已经能定位） */
export function candidateTextColumns(dictionary: DataDictionary, table: string, column?: string): string[] {
  const entry = dictionary.tables[table];
  if (!entry) return [];
  if (column) return entry.auto.columns.some((item) => item.name === column) ? [column] : [];
  return entry.auto.columns
    .filter((item) => TEXT_TYPE.test(item.type) && !item.primaryKey)
    .filter((item) => !(entry.columns[item.name]?.knownValues ?? item.knownValues)?.length)
    .map((item) => item.name)
    .slice(0, FIND_VALUES_MAX_COLUMNS);
}

export const findValuesTool: ToolDefinition = {
  name: 'find_values',
  description:
    '在某张表里按包含匹配找一个字面量（人名、客户名、单号）实际存成什么值：字典没有取值表的文本列才需要。最多探测 3 列、每列 1 秒，返回每列的匹配值供精确过滤或让用户选',
  category: 'doc',
  requiresPermission: [],
  sideEffects: READ_ONLY_CONTRACT,
  parameters: {
    type: 'object',
    properties: {
      source: { type: 'string', description: '数据源名称或 id；只有一个时可省略' },
      table: { type: 'string', description: '物理表名' },
      value: { type: 'string', description: '要找的字面量，如 苏运来' },
      column: { type: 'string', description: '限定某一列（物理列名）；省略则自动挑文本列' },
    },
    required: ['table', 'value'],
  },
  async execute(args, ctx) {
    const { source: ref, table, value, column } = (args ?? {}) as { source?: string; table?: string; value?: string; column?: string };
    const tableName = typeof table === 'string' ? table.trim() : '';
    const needle = typeof value === 'string' ? value.trim() : '';
    const columnName = typeof column === 'string' && column.trim() ? column.trim() : undefined;
    if (!tableName || !isSqlIdentifier(tableName)) return invalid('table 须为合法的表名');
    if (!needle || [...needle].length > 100) return invalid('value 要填，100 字以内');
    if (needle.includes('%') || needle.includes('_')) return invalid('value 里不要带 % 或 _，工具会按包含匹配');
    if (columnName && !isSqlIdentifier(columnName)) return invalid('column 须为合法的列名');
    const deps = getDataToolDeps();
    const resolved = resolveSource(ref, deps);
    if ('error' in resolved) return invalid(resolved.error);
    const source = resolved.source;
    const dictionary = deps.loadDictionary(source.id);
    if (!dictionary.tables[tableName]) return invalid(`字典里没有表 ${tableName}`);
    const columns = candidateTextColumns(dictionary, tableName, columnName);
    if (!columns.length) {
      return invalid(columnName ? `表 ${tableName} 没有列 ${columnName}` : `表 ${tableName} 没有可探测的文本列（有取值表的列请直接用 propose_query_plan 定位）`);
    }
    let connector;
    try {
      connector = deps.getConnector(source.id);
    } catch (error) {
      return { success: false, output: '', error: error instanceof Error ? error.message : String(error), errorCategory: 'external_service_failure' };
    }
    const escaped = needle.replace(/[\\%_]/g, (char) => `\\${char}`);
    const findings: Array<{ column: string; matches: string[]; error?: string }> = [];
    for (const name of columns) {
      const sql = `SELECT DISTINCT ${quoteIdentifier(name)} AS v FROM ${quoteDatabaseName(source.database)}.${quoteIdentifier(tableName)} WHERE ${quoteIdentifier(name)} LIKE ? LIMIT ${FIND_VALUES_MAX_MATCHES}`;
      try {
        const result = await connector.query(sql, [`%${escaped}%`], { maxRows: FIND_VALUES_MAX_MATCHES, timeoutMs: FIND_VALUES_TIMEOUT_MS, signal: ctx.signal });
        findings.push({ column: name, matches: result.rows.map((row) => String(row[0] ?? '')).filter(Boolean) });
      } catch (error) {
        findings.push({ column: name, matches: [], error: error instanceof Error ? error.message : String(error) });
      }
    }
    const lines = findings.map((finding) => {
      const label = columnBusinessName(dictionary, tableName, finding.column) ?? finding.column;
      if (finding.error) return `- ${label}（${finding.column}）：没探测成（${finding.error.slice(0, 80)}）`;
      if (!finding.matches.length) return `- ${label}（${finding.column}）：没有包含「${needle}」的值`;
      return `- ${label}（${finding.column}）：${finding.matches.map((item) => `「${item}」`).join(' ')}${finding.matches.length >= FIND_VALUES_MAX_MATCHES ? '（还有更多）' : ''}`;
    });
    const hits = findings.reduce((sum, finding) => sum + finding.matches.length, 0);
    return {
      success: true,
      output: [
        `在表 ${tableName} 里找「${needle}」：`,
        ...lines,
        hits === 1 ? '只有一个匹配，可直接用精确值过滤' : hits > 1 ? '多个匹配：用 ask_user 让用户选一个，选项就是这些值' : '没找到：确认一下名字是否写对，或换一张表',
      ].join('\n'),
      metadata: { sourceId: source.id, table: tableName, findings },
    };
  },
};
