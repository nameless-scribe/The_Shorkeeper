/**
 * save_named_query（P7.3，计划 §3.6）：用户确认"对，就是这个"之后，把做法存成命名查询。
 * 存的是模板（时间范围与过滤值抽成槽位）+ SQL + 口径说明，不存结果；问题向量化失败也照存。
 */
import type { ToolDefinition, ToolResult } from '../types';
import { LOCAL_UPSERT_CONTRACT } from '../contract';
import { parameterizePlan } from '../../datasources/named-queries';
import { preparePlan } from './plan-preparation';
import { PLAN_PARAMETER_DESCRIPTION } from './propose-query-plan';
import { getDataToolDeps, resolveSource } from './source-access';

function invalid(error: string): ToolResult {
  return { success: false, output: '', error, errorCategory: 'invalid_arguments' };
}

export const saveNamedQueryTool: ToolDefinition = {
  name: 'save_named_query',
  description:
    '用户确认结果正确后，把这次的做法存成命名查询（存的是方案模板与口径，不存结果；时间范围与过滤值会抽成槽位，下次按新问题填）。下次问类似问题时会作为示例提供',
  category: 'doc',
  requiresPermission: [],
  sideEffects: LOCAL_UPSERT_CONTRACT,
  parameters: {
    type: 'object',
    properties: {
      source: { type: 'string', description: '数据源名称或 id；只有一个时可省略' },
      name: { type: 'string', description: '命名查询的名字，业务语言，如 月度客户销售额' },
      question: { type: 'string', description: '用户当时的问题原文' },
      plan: { type: 'object', description: PLAN_PARAMETER_DESCRIPTION },
      notes: { type: 'string', description: '口径说明：确认过的含税 / 扣退款 / 剔除测试账号等' },
    },
    required: ['name', 'question', 'plan'],
  },
  async execute(args, ctx) {
    const { source: ref, name, question, plan, notes } = (args ?? {}) as { source?: string; name?: string; question?: string; plan?: unknown; notes?: string };
    const queryName = typeof name === 'string' ? name.trim() : '';
    const questionText = typeof question === 'string' ? question.trim() : '';
    if (!queryName || [...queryName].length > 100) return invalid('name 要填，100 字以内');
    if (!questionText || [...questionText].length > 1_000) return invalid('question 要填用户的问题原文');
    if (!plan || typeof plan !== 'object') return invalid('缺少 plan（方案对象）');
    if (notes !== undefined && typeof notes !== 'string') return invalid('notes 须为字符串');
    const deps = getDataToolDeps();
    const resolved = resolveSource(ref, deps);
    if ('error' in resolved) return invalid(resolved.error);
    const source = resolved.source;
    const dictionary = deps.loadDictionary(source.id);
    const prepared = preparePlan(plan, source.id, dictionary);
    if (!prepared.ok) return invalid(prepared.error);
    if (!prepared.prepared.ready || !prepared.prepared.compiled) return invalid('只有能执行的方案才能保存：先解决未确定项与未登记指标');
    const payload = parameterizePlan(prepared.prepared.plan);
    const embedding = await deps.embedQuestion(questionText, ctx.signal);
    const existing = deps.listNamedQueries(source.id).find((item) => item.name === queryName);
    const saved = deps.saveNamedQuery({
      ...(existing ? { id: existing.id } : {}),
      sourceId: source.id,
      name: queryName,
      question: questionText,
      planJson: JSON.stringify(payload),
      sql: prepared.prepared.compiled.sql,
      notes: notes?.trim() || null,
      embedding,
    });
    const slots = [
      payload.exampleSlots.timeRange ? '时间范围' : null,
      payload.exampleSlots.filterValues.length ? `${payload.exampleSlots.filterValues.length} 处过滤值` : null,
    ].filter(Boolean);
    return {
      success: true,
      output: `已${existing ? '更新' : '保存'}命名查询「${queryName}」：${prepared.prepared.rendering.summary}${slots.length ? `（${slots.join('与 ')}已抽成槽位，下次按新问题填）` : ''}${embedding ? '' : '；问题没有向量化，相似检索按关键词'}`,
      metadata: { id: saved.id, sourceId: source.id, embedded: Boolean(embedding), updated: Boolean(existing) },
    };
  },
};
