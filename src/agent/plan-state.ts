/** waiting_user 由系统在 ask_user 期间自动标记，模型不直接设置 */
export type AgentPlanItemStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'waiting_user';

export interface AgentPlanItem {
  id: string;
  content: string;
  status: AgentPlanItemStatus;
}

const runPlans = new Map<string, AgentPlanItem[]>();

export function setRunPlan(runId: string, items: AgentPlanItem[]): void {
  runPlans.set(runId, items);
}

export function getRunPlan(runId: string): AgentPlanItem[] {
  return runPlans.get(runId) ?? [];
}

/**
 * ask_user 期间把正在进行的计划项标为"等用户"，回答后改回；返回是否有改动（决定要不要广播）。
 */
export function markRunPlanWaitingUser(runId: string, waiting: boolean): boolean {
  const items = runPlans.get(runId);
  if (!items) return false;
  const from: AgentPlanItemStatus = waiting ? 'in_progress' : 'waiting_user';
  const to: AgentPlanItemStatus = waiting ? 'waiting_user' : 'in_progress';
  let changed = false;
  const next = items.map((item) => {
    if (item.status !== from) return item;
    changed = true;
    return { ...item, status: to };
  });
  if (changed) runPlans.set(runId, next);
  return changed;
}

export function clearRunPlan(runId: string): void {
  runPlans.delete(runId);
}
