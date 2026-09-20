export type RunTerminalReason =
  | 'finished'
  | 'cancelled'
  | 'error'
  | 'max_rounds'
  | 'budget_exhausted'
  | 'awaiting_input'
  | 'repeated_failure'
  | 'outcome_unknown'
  | 'empty_response';

export interface RunFinalizeContext {
  runId: string;
  sessionId: string;
  assistantText: string;
  signal?: AbortSignal;
  reason: RunTerminalReason;
}

/** 统一 Agent run 结束时的持久化决策 */
export function shouldPersistAssistantMessage(ctx: RunFinalizeContext): boolean {
  if (ctx.reason !== 'finished') return false;
  if (ctx.signal?.aborted) return false;
  return Boolean(ctx.assistantText.trim());
}
