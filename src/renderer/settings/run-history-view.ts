import type { TaskRunInfo, TaskRunKind, TaskRunPhase } from '@/shared/types';

export const RUN_KIND_LABELS: Record<TaskRunKind, string> = {
  chat: '对话',
  scheduled: '定时任务',
  voice: '语音',
};

export const RUN_PHASE_LABELS: Record<TaskRunPhase, string> = {
  created: '已创建',
  running: '运行中',
  waiting_tool: '调用工具',
  waiting_approval: '等待确认',
  waiting_user: '等待回答',
  finalizing: '收尾中',
  finished: '已完成',
  cancelled: '已取消',
  error: '失败',
  interrupted: '意外中断',
};

export type RunFilter = 'all' | 'active' | 'finished' | 'attention';

export function runMatchesFilter(run: TaskRunInfo, filter: RunFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'finished') return run.phase === 'finished';
  if (filter === 'attention') return run.phase === 'error' || run.phase === 'interrupted';
  return !['finished', 'cancelled', 'error', 'interrupted'].includes(run.phase);
}

export function runPhaseTone(
  phase: TaskRunPhase,
): 'cyan' | 'green' | 'amber' | 'muted' {
  if (phase === 'finished') return 'green';
  if (phase === 'error' || phase === 'interrupted') return 'amber';
  if (phase === 'running' || phase === 'waiting_tool' || phase === 'waiting_approval' || phase === 'waiting_user') return 'cyan';
  return 'muted';
}

export function formatRunTime(timestamp: number | null): string {
  if (timestamp == null) return '—';
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
}

export function formatRunDuration(run: TaskRunInfo): string {
  const end = run.terminalAt ?? run.updatedAt;
  const milliseconds = Math.max(0, end - run.startedAt);
  if (milliseconds < 1_000) return `${milliseconds}ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(1)}s`;
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  return `${minutes}m ${seconds}s`;
}

const RUN_TERMINAL_REASON_LABELS: Record<string, string> = {
  cancelled: '用户取消了本次运行',
  error: '本次运行执行失败',
  max_rounds: '达到工具调用轮次上限',
  empty_response: '模型没有返回可用内容',
  process_exit: '上次应用退出时运行尚未完成',
  session_not_found: '关联会话不存在',
  consumer_closed: '输出通道提前关闭',
};

export function formatRunIssue(run: TaskRunInfo): string | null {
  if (run.phase === 'finished' && !run.errorSummary) return null;
  const reason = run.terminalReason && run.terminalReason !== 'finished'
    ? (RUN_TERMINAL_REASON_LABELS[run.terminalReason] ?? run.terminalReason)
    : null;
  return [reason, run.errorSummary].filter(Boolean).join('：') || null;
}

const RISK_LABELS: Record<string, string> = {
  read: '只读',
  low: '低',
  medium: '中',
  high: '高',
};

const APPROVAL_DECIDER_LABELS: Record<string, string> = {
  user: '用户',
  timeout: '超时',
  abort: '运行取消',
  window_closed: '窗口关闭',
  startup: '启动恢复',
  error: '确认流程错误',
};

const ERROR_CATEGORY_LABELS: Record<string, string> = {
  invalid_arguments: '参数无效',
  permission_denied: '权限被拒绝',
  path_out_of_scope: '路径超出工作区',
  network_failure: '网络失败',
  external_service_failure: '外部服务失败',
  timeout: '超时',
  cancelled: '已取消',
  internal_error: '内部错误',
};

export function formatRiskLevel(value: string | null): string {
  if (!value) return '未记录';
  return RISK_LABELS[value] ?? value;
}

export function formatApprovalDecider(value: string | null): string | null {
  if (!value) return null;
  return APPROVAL_DECIDER_LABELS[value] ?? value;
}

export function formatErrorCategory(value: string | null): string | null {
  if (!value) return null;
  return ERROR_CATEGORY_LABELS[value] ?? value;
}
