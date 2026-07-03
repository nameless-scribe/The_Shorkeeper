export type AgentPlanItemStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

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

export function clearRunPlan(runId: string): void {
  runPlans.delete(runId);
}
