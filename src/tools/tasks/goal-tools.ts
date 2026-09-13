import {
  closeGoal,
  createGoal,
  formatGoalList,
  getGoal,
  getGoalProgress,
  listGoals,
  MAX_GOAL_PRIORITY,
  updateGoal,
} from '../../db/repositories/goals';
import { normalizeDateOnly } from '../../tasks/due-date';
import { LOCAL_UPSERT_CONTRACT } from '../contract';
import type { ToolDefinition, ToolResult } from '../types';
import type { GoalStatus } from '../../shared/types';

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 4_000;

function fail(error: string): ToolResult {
  return { success: false, output: '', error };
}

function readString(raw: Record<string, unknown>, key: string, max: number): string | null | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string') throw new Error(`${key} 须为字符串`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new Error(`${key} 超过 ${max} 字上限`);
  return trimmed || null;
}

export const manageGoalsTool: ToolDefinition = {
  name: 'manage_goals',
  description:
    '管理用户的中长期目标：create 新建、list 列出（含待办进度）、update 修改标题/说明/优先级/目标日期或暂停恢复、close 标为 done 或 dropped。' +
    '目标用于给待办和承诺分组，不要为一次性小事创建目标。',
  category: 'life',
  requiresPermission: [],
  sideEffects: LOCAL_UPSERT_CONTRACT,
  describeCall(args) {
    const action = args && typeof args === 'object' ? (args as { action?: unknown }).action : undefined;
    if (action === 'list') return { risk: 'read', idempotent: true, reversible: 'none' };
    if (action === 'create') return { idempotent: false };
    return {};
  },
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create', 'list', 'update', 'close'] },
      id: { type: 'string', description: 'update/close 必填' },
      title: { type: 'string' },
      description: { type: 'string' },
      priority: { type: 'number', description: `0-${MAX_GOAL_PRIORITY}，越大越优先` },
      target_date: { type: 'string', description: '目标日期 YYYY-MM-DD，可选' },
      status: {
        type: 'string',
        enum: ['active', 'paused', 'done', 'dropped'],
        description: 'update 只接受 active/paused；close 只接受 done/dropped；list 用于筛选',
      },
      include_closed: { type: 'boolean', description: 'list 时是否包含已关闭目标' },
    },
    required: ['action'],
  },
  async execute(args) {
    const raw = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
    const action = raw.action;
    try {
      if (action === 'list') {
        const status = typeof raw.status === 'string' ? (raw.status as GoalStatus) : undefined;
        if (status && !['active', 'paused', 'done', 'dropped'].includes(status)) {
          return fail(`无效状态: ${status}`);
        }
        const goals = listGoals({ status, includeClosed: raw.include_closed === true });
        return {
          success: true,
          output: formatGoalList(goals.map((goal) => ({ ...goal, progress: getGoalProgress(goal.id) }))),
        };
      }

      if (action === 'create') {
        const title = readString(raw, 'title', MAX_TITLE);
        if (!title) return fail('缺少 title 参数');
        const targetDate = readString(raw, 'target_date', 20);
        if (targetDate && !normalizeDateOnly(targetDate)) return fail('target_date 须为 YYYY-MM-DD');
        const goal = createGoal({
          title,
          description: readString(raw, 'description', MAX_DESCRIPTION) ?? null,
          priority: typeof raw.priority === 'number' ? raw.priority : undefined,
          targetDate: targetDate ?? null,
        });
        return { success: true, output: `已创建目标。\n${formatGoalList([goal])}`, metadata: { goalId: goal.id } };
      }

      const id = readString(raw, 'id', 200);
      if (!id) return fail('缺少 id 参数');
      const existing = getGoal(id);
      if (!existing) return fail(`未找到目标: ${id}`);

      if (action === 'update') {
        const status = raw.status;
        if (status !== undefined && status !== 'active' && status !== 'paused') {
          return fail('update 的 status 只能是 active 或 paused；关闭目标请用 close');
        }
        const targetDate = readString(raw, 'target_date', 20);
        if (targetDate && !normalizeDateOnly(targetDate)) return fail('target_date 须为 YYYY-MM-DD');
        const updated = updateGoal(id, {
          title: readString(raw, 'title', MAX_TITLE) ?? undefined,
          description: readString(raw, 'description', MAX_DESCRIPTION),
          priority: typeof raw.priority === 'number' ? raw.priority : undefined,
          targetDate,
          status: status as 'active' | 'paused' | undefined,
        });
        return { success: true, output: `已更新目标。\n${formatGoalList(updated ? [updated] : [])}` };
      }

      if (action === 'close') {
        const status = raw.status;
        if (status !== 'done' && status !== 'dropped') return fail('close 的 status 只能是 done 或 dropped');
        const closed = closeGoal(id, status);
        return { success: true, output: `已关闭目标（${status}）。\n${formatGoalList(closed ? [closed] : [])}` };
      }

      return fail(`未知 action: ${String(action)}`);
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  },
};
