/**
 * propose_query_plan 与 run_sql_query 共用的"准备"步骤：解析方案 → 补指标口径 → 值定位 → 渲染 → 编译。
 * 纯函数（依赖注入的字典），两个工具对同一份方案得到同一份结果。
 */
import { findMetric, type DataDictionary } from '../../datasources/dictionary';
import { compileQueryPlan, type CompiledPlan } from '../../datasources/plan-compiler';
import { renderQueryPlan, type PlanRendering } from '../../datasources/plan-render';
import { isListPlan, parseQueryPlan, type QueryPlan } from '../../datasources/query-plan';
import { locateFilterValues } from '../../datasources/value-locator';

export const UNDEFINED_METRIC_FRAGMENT = 'NULL';

export interface PreparedPlan {
  plan: QueryPlan;
  rendering: PlanRendering;
  /** 值定位等给回复用的说明 */
  notes: string[];
  warnings: string[];
  /** 未定义的指标：要先确认口径再存 */
  undefinedMetrics: string[];
  ready: boolean;
  compiled: CompiledPlan | null;
  compileError: string | null;
}

export type PrepareResult = { ok: true; prepared: PreparedPlan } | { ok: false; error: string };

export function preparePlan(rawPlan: unknown, sourceId: string, dictionary: DataDictionary): PrepareResult {
  const input = typeof rawPlan === 'object' && rawPlan !== null && !Array.isArray(rawPlan) ? { ...(rawPlan as Record<string, unknown>) } : rawPlan;
  if (input && typeof input === 'object') {
    const record = input as Record<string, unknown>;
    if (!record.sourceId) record.sourceId = sourceId;
    // 指标只给了名字时，从字典补口径
    if (Array.isArray(record.metrics)) {
      record.metrics = record.metrics.map((item) => {
        if (item && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string') {
          const metric = item as { name: string; fragment?: unknown };
          const defined = findMetric(dictionary, metric.name);
          if (typeof metric.fragment !== 'string' || !metric.fragment.trim()) {
            // 已定义：补口径；未定义：占位，让方案先通过解析，再作为"未登记指标"报出来
            return { name: metric.name, fragment: defined ? defined.sqlFragment : UNDEFINED_METRIC_FRAGMENT };
          }
        }
        return item;
      });
    }
  }
  const parsed = parseQueryPlan(input);
  if ('error' in parsed) return { ok: false, error: `方案不合规：${parsed.error}` };
  if (parsed.plan.sourceId !== sourceId) return { ok: false, error: '方案的 sourceId 与指定的数据源不一致' };

  if (!dictionary.tables[parsed.plan.fact.table]) {
    return { ok: false, error: `字典里没有表 ${parsed.plan.fact.table}；先用 describe_data_source 看表清单` };
  }

  const undefinedMetrics = parsed.plan.metrics.filter((metric) => !findMetric(dictionary, metric.name)).map((metric) => metric.name);
  const located = locateFilterValues(parsed.plan, dictionary);
  const plan = located.plan;
  const rendering = renderQueryPlan(plan, dictionary);
  const warnings: string[] = [];
  if (undefinedMetrics.length) {
    warnings.push(
      `指标「${undefinedMetrics.join('」「')}」还没有登记口径：先用 ask_user 向用户确认怎么算，再用 update_data_dictionary 存进指标，然后重新提方案`,
    );
  }
  if (rendering.missingNames.length) {
    warnings.push(`这些表或列在字典里没有业务名：${rendering.missingNames.join('、')}。问用户"这叫什么"并用 update_data_dictionary 补上，回复里不要出现物理名`);
  }
  if (plan.rawSql) warnings.push('走了自定义 SQL 的逃生口：没有自检，回复里要注明"未经自动核对"');

  const ready = plan.unresolved.length === 0 && undefinedMetrics.length === 0;
  let compiled: CompiledPlan | null = null;
  let compileError: string | null = null;
  if (ready) {
    const result = compileQueryPlan(plan, dictionary);
    if (result.ok) {
      compiled = result.compiled;
      warnings.push(...result.compiled.warnings.filter((warning) => !warnings.includes(warning)));
    } else {
      compileError = result.error;
    }
  }
  return {
    ok: true,
    prepared: {
      plan,
      rendering,
      notes: located.notes,
      warnings,
      undefinedMetrics,
      ready: ready && compiled !== null,
      compiled,
      compileError,
    },
  };
}

/** 给模型看的方案说明：业务语言在前，未确定项与提醒在后 */
export function formatPreparedPlan(prepared: PreparedPlan): string {
  const lines = [`方案摘要：${prepared.rendering.summary}`, ...prepared.rendering.lines.map((line) => `- ${line}`)];
  if (prepared.notes.length) lines.push(...prepared.notes.map((note) => `- 说明：${note}`));
  if (prepared.plan.unresolved.length) {
    lines.push('未确定项（用 ask_user 一次问一个，带选项）：');
    for (const item of prepared.plan.unresolved) {
      lines.push(`- [${item.slot}] ${item.question}${item.options?.length ? `（选项：${item.options.join(' / ')}）` : ''}`);
    }
  }
  if (prepared.warnings.length) lines.push(...prepared.warnings.map((warning) => `- 提醒：${warning}`));
  if (prepared.compileError) lines.push(`- 方案编不出来：${prepared.compileError}`);
  lines.push(isListPlan(prepared.plan) ? '形状：清单（不聚合）' : prepared.plan.rawSql ? '形状：自定义 SQL' : '形状：汇总统计');
  lines.push(prepared.ready ? '可以执行：把下面这份方案原样传给 run_sql_query' : '还不能执行：先解决上面的未确定项与提醒');
  lines.push('```json', JSON.stringify(prepared.plan), '```');
  return lines.join('\n');
}
