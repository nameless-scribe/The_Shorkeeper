/**
 * 查询方案的业务语言渲染（P7.0，计划 §3.3、§3.11）。
 *
 * 给用户看的永远是这份文字：用字典里的业务名，不出现表名、列名、连接、聚合函数。
 * 字典没有业务名的表列，用说明；两者都没有，方案应标"未确定"并问用户"这个数据叫什么"，
 * 这里则以"某项数据"占位并在 `missingNames` 里列出，供技能把它转成追问。
 */

import { columnBusinessName, enumLabel, tableBusinessName, type DataDictionary } from './dictionary';
import { splitQualifiedColumn, type QueryPlan } from './query-plan';

export interface PlanRendering {
  /** 一段话，可直接放进回复或确认弹窗 */
  summary: string;
  /** 逐项要点，供"查看详情" */
  lines: string[];
  /** 字典里没有业务名的表或列（物理名），技能据此追问 */
  missingNames: string[];
  /** 未确定项的问题原文 */
  questions: string[];
}

function formatDate(value: string): string {
  const [date] = value.split(/[T ]/);
  const [year, month, day] = date.split('-').map(Number);
  return `${year} 年 ${month} 月 ${day} 日`;
}

/** 左闭右开的区间说成人话：整月、整年、整日或起止日 */
export function describeTimeRange(from: string, to: string): string {
  const [f] = from.split(/[T ]/);
  const [t] = to.split(/[T ]/);
  const fy = Number(f.slice(0, 4)), fm = Number(f.slice(5, 7)), fd = Number(f.slice(8, 10));
  const ty = Number(t.slice(0, 4)), tm = Number(t.slice(5, 7)), td = Number(t.slice(8, 10));
  if (fm === 1 && fd === 1 && tm === 1 && td === 1 && ty === fy + 1) return `${fy} 年全年`;
  const nextMonth = fm === 12 ? { y: fy + 1, m: 1 } : { y: fy, m: fm + 1 };
  if (fd === 1 && td === 1 && ty === nextMonth.y && tm === nextMonth.m) return `${fy} 年 ${fm} 月`;
  const nextDay = new Date(Date.UTC(fy, fm - 1, fd + 1));
  if (ty === nextDay.getUTCFullYear() && tm === nextDay.getUTCMonth() + 1 && td === nextDay.getUTCDate()) return formatDate(f);
  const lastDay = new Date(Date.UTC(ty, tm - 1, td - 1));
  return `${formatDate(f)} 到 ${lastDay.getUTCFullYear()} 年 ${lastDay.getUTCMonth() + 1} 月 ${lastDay.getUTCDate()} 日`;
}

const OP_TEXT: Record<string, (name: string, values: string[]) => string> = {
  eq: (name, values) => `${name}是「${values[0]}」`,
  neq: (name, values) => `${name}不是「${values[0]}」`,
  in: (name, values) => `${name}在「${values.join('、')}」之内`,
  gte: (name, values) => `${name}不小于 ${values[0]}`,
  lte: (name, values) => `${name}不大于 ${values[0]}`,
  like: (name, values) => `${name}包含「${values[0].replace(/%/g, '')}」`,
};

export function renderQueryPlan(plan: QueryPlan, dictionary: DataDictionary): PlanRendering {
  const missing: string[] = [];
  const nameOfTable = (table: string) => {
    const name = tableBusinessName(dictionary, table);
    if (!name) missing.push(table);
    return name ?? '某项数据';
  };
  const nameOfColumn = (qualified: string) => {
    const { table, column } = splitQualifiedColumn(qualified);
    const name = columnBusinessName(dictionary, table, column);
    if (!name) missing.push(qualified);
    return name ?? '某个字段';
  };

  const lines: string[] = [];
  const subject = nameOfTable(plan.fact.table);

  if (plan.rawSql) {
    lines.push(`这个问题超出了常规统计的形状，我会按自定义的方式直接查询${subject}；这个结果未经自动核对，请留意。`);
  }

  const timeText = plan.timeRange ? describeTimeRange(plan.timeRange.from, plan.timeRange.to) : null;
  if (plan.timeRange) {
    const column = columnBusinessName(dictionary, plan.fact.table, plan.timeRange.column);
    lines.push(`时间范围：${timeText}${column ? `（按${column}）` : ''}`);
  } else {
    lines.push('时间范围：不限');
  }

  const metricNames = plan.metrics.map((metric) => metric.name);
  if (metricNames.length) lines.push(`统计：${metricNames.join('、')}`);

  const grainNames = plan.grain.map(nameOfColumn);
  lines.push(grainNames.length ? `按${grainNames.join('、')}分别统计` : '整体汇总，不拆分');

  const filterTexts = plan.filters.map((filter) => {
    const { table, column } = splitQualifiedColumn(filter.column);
    const values = filter.values.map((value) => enumLabel(dictionary, table, column, value));
    return OP_TEXT[filter.op](nameOfColumn(filter.column), values);
  });
  if (filterTexts.length) lines.push(`只算：${filterTexts.join('；')}`);

  if (plan.compare) lines.push(plan.compare.kind === 'yoy' ? '并与去年同期对比' : '并与上一个月对比');

  const order = plan.orderBy
    ? `按${plan.orderBy.metric}${plan.orderBy.direction === 'desc' ? '从高到低' : '从低到高'}`
    : metricNames.length ? `按${metricNames[0]}从高到低` : '';
  lines.push(`${order ? `${order}，` : ''}最多取 ${plan.limit} 条`);

  const questions = plan.unresolved.map((item) => item.question);

  const summaryParts = [
    `我准备这样统计：${timeText ?? '不限时间'}${plan.timeRange && columnBusinessName(dictionary, plan.fact.table, plan.timeRange.column) ? `（按${columnBusinessName(dictionary, plan.fact.table, plan.timeRange.column)}）` : ''}`,
    grainNames.length ? `每个${grainNames.join('、')}的${metricNames.join('和') || subject}` : `${subject}的${metricNames.join('和')}整体汇总`,
  ];
  let summary = `${summaryParts.join('，')}`;
  if (filterTexts.length) summary += `，只算${filterTexts.join('、')}`;
  if (plan.compare) summary += plan.compare.kind === 'yoy' ? '，并和去年同期比' : '，并和上个月比';
  summary += `，${order ? `${order}取前 ${plan.limit} 条` : `最多 ${plan.limit} 条`}。`;
  if (questions.length) summary += `有一点要确认：${questions[0]}`;

  return { summary, lines, missingNames: [...new Set(missing)], questions };
}

const TECHNICAL_PATTERN = /\b(SELECT|FROM|WHERE|JOIN|GROUP BY|ORDER BY|LIMIT|SUM|COUNT|AVG|DISTINCT|EXPLAIN)\b|`/i;

/** 表现层断言（§3.11）：渲染结果里不得出现 SQL 关键字与反引号标识符。 */
export function containsTechnicalTerms(text: string): boolean {
  return TECHNICAL_PATTERN.test(text);
}
