/**
 * list_data_sources / describe_data_source（P7.2，计划 §3.9）：只读，不发数据库请求，只读本地字典。
 * 两者在 CORE_TOOL_NAMES 里，技能未激活时模型也能发现有数据源可查。
 */
import type { ToolDefinition, ToolResult } from '../types';
import { READ_ONLY_CONTRACT } from '../contract';
import { CATALOG_MAX_TABLES, focusedTables, formatMetrics, formatTableCatalog, formatTableDetail, type DataDictionary } from '../../datasources/dictionary';
import { pickTablesForQuestion } from '../../datasources/table-search';
import { describeNamedQueryExample, findSimilarNamedQueries } from '../../datasources/named-queries';
import { describeDateContext, getDataToolDeps, NO_SOURCE_MESSAGE, resolveSource } from './source-access';

function invalid(error: string): ToolResult {
  return { success: false, output: '', error, errorCategory: 'invalid_arguments' };
}

export const listDataSourcesTool: ToolDefinition = {
  name: 'list_data_sources',
  description: '列出已配置的业务数据库（只读）。没有配置时会说明，此时不要猜数据',
  category: 'doc',
  requiresPermission: [],
  sideEffects: READ_ONLY_CONTRACT,
  parameters: { type: 'object', properties: {} },
  async execute() {
    const deps = getDataToolDeps();
    const sources = deps.listSources();
    if (!sources.length) return { success: true, output: NO_SOURCE_MESSAGE, metadata: { count: 0 } };
    const lines = sources.map((source) => {
      const status = source.lastError ? `上次连接失败：${source.lastError}` : source.lastOkAt ? '已连通' : '未测试';
      const tables = Object.keys(deps.loadDictionary(source.id).tables).length;
      return `- ${source.name}（数据库 ${source.database}，${status}，字典里 ${tables} 张表）`;
    });
    return { success: true, output: `已配置 ${sources.length} 个数据源：\n${lines.join('\n')}`, metadata: { count: sources.length } };
  },
};

function subsetDictionary(dictionary: DataDictionary, tables: string[]): DataDictionary {
  const subset: DataDictionary = { sourceId: dictionary.sourceId, tables: {}, metrics: dictionary.metrics };
  for (const name of tables) if (dictionary.tables[name]) subset.tables[name] = { ...dictionary.tables[name], manual: { ...dictionary.tables[name].manual, focused: true } };
  return subset;
}

export const describeDataSourceTool: ToolDefinition = {
  name: 'describe_data_source',
  description:
    '看某个数据源能查什么：关注表清单与一句话说明、已定义指标、今天的日期锚点；给 table 时返回该表的列与字典条目（业务名、枚举含义、取值）。不发数据库请求',
  category: 'doc',
  requiresPermission: [],
  sideEffects: READ_ONLY_CONTRACT,
  parameters: {
    type: 'object',
    properties: {
      source: { type: 'string', description: '数据源名称或 id；只有一个时可省略' },
      table: { type: 'string', description: '要看详情的表（物理表名）；省略则给表清单与指标' },
      question: { type: 'string', description: '用户的问题原文；关注表很多时用它挑相关的表' },
    },
  },
  async execute(args, ctx) {
    const { source: ref, table, question } = (args ?? {}) as { source?: string; table?: string; question?: string };
    const deps = getDataToolDeps();
    const resolved = resolveSource(ref, deps);
    if ('error' in resolved) return invalid(resolved.error);
    const source = resolved.source;
    const dictionary = deps.loadDictionary(source.id);
    const tableCount = Object.keys(dictionary.tables).length;
    if (!tableCount) {
      return {
        success: true,
        output: `数据源「${source.name}」还没有读取过结构：请让用户到 设置 → 数据源 点"刷新结构"，之后才能查`,
        metadata: { sourceId: source.id, tables: 0 },
      };
    }
    const header = [`数据源「${source.name}」（方案里 sourceId 填 ${source.id}）`, describeDateContext(deps.now())];

    if (table) {
      const detail = formatTableDetail(dictionary, table.trim());
      if (!detail) return invalid(`字典里没有表 ${table}；先用不带 table 的调用看表清单`);
      return { success: true, output: [...header, detail].join('\n'), metadata: { sourceId: source.id, table: table.trim() } };
    }

    const focused = focusedTables(dictionary);
    let catalog: string;
    let picked: string[] | null = null;
    if (focused.length > CATALOG_MAX_TABLES && question?.trim()) {
      picked = pickTablesForQuestion(dictionary, question, CATALOG_MAX_TABLES).map((item) => item.table);
      catalog = `关注表有 ${focused.length} 张，按问题挑出 ${picked.length} 张：\n${formatTableCatalog(subsetDictionary(dictionary, picked))}`;
    } else {
      catalog = `表清单（${focused.length} 张${focused.length < tableCount ? `，共 ${tableCount} 张，只列关注的` : ''}）：\n${formatTableCatalog(dictionary)}`;
    }
    let examples: string[] = [];
    if (question?.trim()) {
      const candidates = deps.listNamedQueries(source.id);
      if (candidates.length) {
        const embedding = candidates.some((item) => item.embedding) ? await deps.embedQuestion(question, ctx.signal) : null;
        examples = findSimilarNamedQueries(candidates, question, embedding).map((match) => `- ${describeNamedQueryExample(match.query, dictionary)}`);
      }
    }
    const output = [
      ...header,
      catalog,
      `指标：\n${formatMetrics(dictionary)}`,
      ...(examples.length
        ? [`相似的过往查询（做法示例，不是答案；时间范围与过滤值一律按当前问题填，当前问题没给时间范围仍要问）：\n${examples.join('\n')}`]
        : []),
      '下一步：需要哪张表的列，就再调一次并给 table；方案里的表名列名用物理名，回复里只用业务名。',
    ].join('\n');
    return { success: true, output, metadata: { sourceId: source.id, tables: tableCount, focused: focused.length, picked, examples: examples.length } };
  },
};
