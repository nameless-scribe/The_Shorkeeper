export type RunTerminalReason =
  | 'finished'
  | 'cancelled'
  | 'error'
  | 'max_rounds'
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
