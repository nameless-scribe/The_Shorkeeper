import { setRunPlan, type AgentPlanItem, type AgentPlanItemStatus } from '../../agent/plan-state';
import type { ToolDefinition } from '../types';
import { LOCAL_UPSERT_CONTRACT } from '../contract';

const VALID_STATUSES = new Set<AgentPlanItemStatus>([
  'pending',
  'in_progress',
  'completed',
  'cancelled',
]);

function normalizeItems(raw: unknown): { items: AgentPlanItem[]; error?: string } {
  if (!Array.isArray(raw)) {
    return { items: [], error: 'items 必须是数组' };
  }

  const items: AgentPlanItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      return { items: [], error: 'items 中每项必须是对象' };
    }
    const row = entry as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    const content = typeof row.content === 'string' ? row.content.trim() : '';
    const status = typeof row.status === 'string' ? row.status.trim() : 'pending';
    if (!id || !content) {
      return { items: [], error: '每项必须包含非空 id 与 content' };
    }
    if (!VALID_STATUSES.has(status as AgentPlanItemStatus)) {
      return { items: [], error: `无效状态: ${status}` };
    }
    items.push({ id, content, status: status as AgentPlanItemStatus });
  }

  return { items };
}

export const updateAgentPlanTool: ToolDefinition = {
  name: 'update_agent_plan',
  description:
    '更新当前任务的执行计划（覆盖式）。复杂多步任务（读文件、分析、写回）应先列出步骤，每完成一步后更新状态。',
  category: 'skill',
  requiresPermission: [],
  sideEffects: LOCAL_UPSERT_CONTRACT,
  parameters: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        description: '计划项列表',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '步骤唯一 id，如 step-1' },
            content: { type: 'string', description: '步骤描述' },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed', 'cancelled'],
            },
          },
          required: ['id', 'content', 'status'],
        },
      },
    },
    required: ['items'],
  },
  async execute(args, ctx) {
    const { items: rawItems } = args as { items?: unknown };
    const { items, error } = normalizeItems(rawItems);
    if (error) {
      return { success: false, output: '', error };
    }

    const runId = ctx.runId;
    if (!runId) {
      return { success: false, output: '', error: '内部错误：缺少 runId' };
    }

    setRunPlan(runId, items);
    return {
      success: true,
      output: JSON.stringify({ updated: items.length, items }, null, 2),
    };
  },
};
