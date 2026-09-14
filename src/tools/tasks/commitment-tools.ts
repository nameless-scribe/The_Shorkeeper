import {
  cancelCommitmentForScheduledTask,
  completeCommitment,
  confirmProposedCommitment,
  createUserCommitmentWithTask,
  formatCommitmentList,
  getCommitment,
  listCommitments,
  setCommitmentStatus,
  updateCommitment,
} from '../../db/repositories/commitments';
import { getGoal } from '../../db/repositories/goals';
import { notifyUserTasksChanged } from '../../tasks/user-task-events';
import { addLocalDays, formatLocalDate, localDayEnd, parseDueInput } from '../../tasks/due-date';
import { LOCAL_APPEND_CONTRACT } from '../contract';
import type { ToolDefinition, ToolResult } from '../types';
import type { CommitmentStatus } from '../../shared/types';

export { cancelCommitmentForScheduledTask };

const MAX_TITLE = 300;
const MAX_PROMISED_TO = 100;
const STATUSES: readonly CommitmentStatus[] = ['proposed', 'open', 'done', 'missed', 'cancelled'];

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

export const manageCommitmentsTool: ToolDefinition = {
  name: 'manage_commitments',
  description:
    '管理承诺：record 记录用户答应别人或自己的事（会自动创建关联待办）、confirm 确认对话中识别出的待确认承诺、' +
    'list 列出、update 修改截止或对象、complete 标为完成（同时完成关联待办）、cancel 取消。' +
    '助理自己的承诺由创建提醒时自动记录，不要用本工具重复记录。',
  category: 'life',
  requiresPermission: [],
  sideEffects: LOCAL_APPEND_CONTRACT,
  describeCall(args) {
    const action = args && typeof args === 'object' ? (args as { action?: unknown }).action : undefined;
    if (action === 'list') return { risk: 'read', idempotent: true, reversible: 'none' };
    if (action === 'record') return {};
    return { idempotent: true };
  },
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['record', 'confirm', 'list', 'update', 'complete', 'cancel'] },
      id: { type: 'string', description: 'confirm/update/complete/cancel 必填' },
      title: { type: 'string', description: 'record 必填：承诺内容' },
      due_at: { type: 'string', description: '截止 YYYY-MM-DD 或 ISO 本地时间（如 2026-09-20T18:00:00）' },
      promised_to: { type: 'string', description: '答应了谁，可选' },
      goal_id: { type: 'string', description: '所属目标 id，可选' },
      task_id: { type: 'string', description: 'record 时关联已有待办；省略则自动创建同名待办' },
      status: {
        type: 'string',
        enum: ['proposed', 'open', 'done', 'missed', 'cancelled'],
        description: 'list 筛选',
      },
      due_within_days: { type: 'number', description: 'list 时只看几天内到期的承诺' },
    },
    required: ['action'],
  },
  async execute(args, ctx) {
    const raw = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
    const action = raw.action;
    try {
      if (action === 'list') {
        const status = raw.status;
        if (status !== undefined && !STATUSES.includes(status as CommitmentStatus)) {
          return fail(`无效状态: ${String(status)}`);
        }
        let dueBefore: number | undefined;
        if (raw.due_within_days !== undefined) {
          const days = Number(raw.due_within_days);
          if (!Number.isFinite(days) || days < 0 || days > 365) return fail('due_within_days 须为 0-365');
          const target = addLocalDays(formatLocalDate(), Math.floor(days));
          dueBefore = target ? localDayEnd(target) ?? undefined : undefined;
        }
        const items = listCommitments({
          status: status as CommitmentStatus | undefined,
          // 未显式指定状态时都排除 done / cancelled；但带 due_before 的"过去到期"查询必须包含 missed，
          // 否则"哪些承诺在 X 之前到期"恰好过滤掉了最该被看到的那一类。
          ...(status === undefined
            ? { statuses: dueBefore === undefined ? ['proposed', 'open'] : ['proposed', 'open', 'missed'] }
            : {}),
          dueBefore,
        });
        return { success: true, output: formatCommitmentList(items) };
      }

      if (action === 'record') {
        const title = readString(raw, 'title', MAX_TITLE);
        if (!title) return fail('缺少 title 参数');
        const dueRaw = readString(raw, 'due_at', 40);
        const due = dueRaw ? parseDueInput(dueRaw) : null;
        if (dueRaw && !due) return fail('due_at 须为 YYYY-MM-DD 或 ISO 本地时间');
        const goalId = readString(raw, 'goal_id', 200) ?? null;
        if (goalId && !getGoal(goalId)) return fail(`未找到目标: ${goalId}`);
        const { commitment, taskCreated } = createUserCommitmentWithTask({
          title,
          dueAt: due?.dueAt ?? null,
          dueDate: due?.dueDate ?? null,
          promisedTo: readString(raw, 'promised_to', MAX_PROMISED_TO) ?? null,
          goalId,
          taskId: readString(raw, 'task_id', 200) ?? null,
          sourceSessionId: ctx.sessionId || null,
          sourceRunId: ctx.runId ?? null,
        });
        if (taskCreated) notifyUserTasksChanged();
        return {
          success: true,
          output: `已记录承诺${taskCreated ? '，并创建了对应待办' : ''}。\n${formatCommitmentList([commitment])}`,
          metadata: { commitmentId: commitment.id, taskId: commitment.taskId },
        };
      }

      const id = readString(raw, 'id', 200);
      if (!id) return fail('缺少 id 参数');
      const existing = getCommitment(id);
      if (!existing) return fail(`未找到承诺: ${id}`);

      if (action === 'confirm') {
        if (existing.status !== 'proposed') return fail('只有待确认的承诺需要 confirm');
        const dueRaw = readString(raw, 'due_at', 40);
        const due = dueRaw ? parseDueInput(dueRaw) : null;
        if (dueRaw && !due) return fail('due_at 须为 YYYY-MM-DD 或 ISO 本地时间');
        const goalId = readString(raw, 'goal_id', 200);
        if (goalId && !getGoal(goalId)) return fail(`未找到目标: ${goalId}`);
        // 先校验再写：截止时间只有在整个 confirm 能成立时才落库。
        if (due) updateCommitment(id, { dueAt: due.dueAt });
        const confirmed = confirmProposedCommitment(id, { dueDate: due?.dueDate ?? null, goalId: goalId ?? undefined });
        notifyUserTasksChanged();
        return { success: true, output: `已确认承诺。\n${formatCommitmentList(confirmed ? [confirmed] : [])}` };
      }

      if (action === 'update') {
        if (existing.status === 'proposed') return fail('待确认的承诺请先 confirm，再修改');
        if (existing.status === 'done' || existing.status === 'cancelled' || existing.status === 'missed') {
          return fail(`承诺已处于 ${existing.status} 状态，不能再修改；需要的话请重新 record`);
        }
        const dueRaw = readString(raw, 'due_at', 40);
        const due = dueRaw ? parseDueInput(dueRaw) : null;
        if (dueRaw && !due) return fail('due_at 须为 YYYY-MM-DD 或 ISO 本地时间');
        const goalId = readString(raw, 'goal_id', 200);
        if (goalId && !getGoal(goalId)) return fail(`未找到目标: ${goalId}`);
        const updated = updateCommitment(id, {
          title: readString(raw, 'title', MAX_TITLE) ?? undefined,
          dueAt: due ? due.dueAt : dueRaw === null ? null : undefined,
          promisedTo: readString(raw, 'promised_to', MAX_PROMISED_TO),
          goalId,
        });
        return { success: true, output: `已更新承诺。\n${formatCommitmentList(updated ? [updated] : [])}` };
      }

      if (action === 'complete') {
        if (existing.status === 'done') return { success: true, output: `承诺已经是完成状态。\n${formatCommitmentList([existing])}` };
        if (existing.status === 'proposed') return fail('待确认的承诺请先 confirm（会建立对应待办），再标记完成');
        if (existing.status === 'cancelled') return fail('承诺已取消，不能标记完成');
        const completed = completeCommitment(id, { evidenceRunId: ctx.runId ?? null });
        notifyUserTasksChanged();
        return { success: true, output: `已标记承诺完成。\n${formatCommitmentList(completed ? [completed] : [])}` };
      }

      if (action === 'cancel') {
        if (existing.status === 'cancelled') return { success: true, output: `承诺已经取消。` };
        const cancelled = setCommitmentStatus(id, 'cancelled');
        return {
          success: true,
          output: `已取消承诺；关联待办保留，如需一并取消请使用 update_user_task。\n${formatCommitmentList(cancelled ? [cancelled] : [])}`,
        };
      }

      return fail(`未知 action: ${String(action)}`);
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  },
};
