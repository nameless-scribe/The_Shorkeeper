import type { LlmMessage, OpenAIToolCall, PermissionPolicy } from './types';
import { createCallId, ev } from './events';
import { getRunPlan, clearRunPlan } from './plan-state';
import {
  checkPermission,
  confirmPermission,
  defaultPermissionPolicy,
  ensureWorkspaceDir,
} from './permissions';
import type { AgUiEvent } from './types';
import { loadModelConfig } from '../models/config';
import { streamChat } from '../models/stream-chat';
import type { ToolRegistry } from '../tools/registry';
import type { ToolContext, ToolResult } from '../tools/types';
import { createToolError, normalizeToolResult } from '../tools/result';
import { awaitWithAbort, createLinkedTimeoutSignal } from './abort';

export const DEFAULT_MODEL_ROUND_TIMEOUT_MS = 120_000;
export const DEFAULT_TOOL_EXECUTION_TIMEOUT_MS = 120_000;

export interface AgentLoopOptions {
  sessionId: string;
  runId: string;
  messages: LlmMessage[];
  registry: ToolRegistry;
  maxRounds?: number;
  policy?: PermissionPolicy;
  signal?: AbortSignal;
  cacheStablePrefix?: string;
  onPhaseChange?: (phase: 'running' | 'waiting_tool') => void;
  onModelRoundStart?: (round: number) => void;
  onModelRoundEnd?: (
    round: number,
    status: 'succeeded' | 'failed' | 'cancelled',
    errorMessage?: string,
  ) => void;
  onPermissionStart?: (toolName: string) => string | undefined;
  onPermissionEnd?: (
    activityId: string,
    status: 'succeeded' | 'failed' | 'cancelled',
    errorMessage?: string,
  ) => void;
  modelTimeoutMs?: number;
  toolTimeoutMs?: number;
}

function parseToolArgs(raw: string): { args: unknown; error?: string } {
  try {
    return { args: JSON.parse(raw || '{}') };
  } catch {
    return { args: null, error: '工具参数 JSON 解析失败' };
  }
}

async function executeToolCall(
  toolCall: OpenAIToolCall,
  ctx: ToolContext,
  registry: ToolRegistry,
  policy: PermissionPolicy,
  hooks?: Pick<AgentLoopOptions, 'onPermissionStart' | 'onPermissionEnd'>,
): Promise<ToolResult> {
  const tool = registry.get(toolCall.function.name);
  if (!tool) {
    return createToolError(`未知工具: ${toolCall.function.name}`, 'internal_error');
  }

  const parsed = parseToolArgs(toolCall.function.arguments);
  if (parsed.error) {
    return createToolError(parsed.error, 'invalid_arguments');
  }

  const args = parsed.args;
  const decision = checkPermission(tool, policy, args);

  if (decision === 'deny') {
    return createToolError(
      `权限被拒绝: ${toolCall.function.name}`,
      'permission_denied',
    );
  }

  if (decision === 'confirm') {
    const activityId = hooks?.onPermissionStart?.(tool.name);
    let approved: boolean;
    try {
      approved = await confirmPermission(tool.name, args, ctx.signal);
    } catch (error) {
      if (activityId) {
        hooks?.onPermissionEnd?.(
          activityId,
          ctx.signal.aborted ? 'cancelled' : 'failed',
          ctx.signal.aborted ? '已取消' : error instanceof Error ? error.message : String(error),
        );
      }
      throw error;
    }
    if (activityId) {
      hooks?.onPermissionEnd?.(
        activityId,
        approved ? 'succeeded' : ctx.signal.aborted ? 'cancelled' : 'failed',
        approved ? undefined : ctx.signal.aborted ? '已取消' : '用户拒绝了此操作',
      );
    }
    if (!approved) {
      return createToolError(
        ctx.signal.aborted ? '已取消' : '用户拒绝了此操作',
        ctx.signal.aborted ? 'cancelled' : 'permission_denied',
      );
    }
  }

  return normalizeToolResult(await tool.execute(args, ctx));
}

export async function* runAgentLoop(
  options: AgentLoopOptions,
): AsyncGenerator<AgUiEvent> {
  const {
    sessionId,
    runId,
    registry,
    maxRounds = 10,
    policy = defaultPermissionPolicy(),
    signal,
    modelTimeoutMs = DEFAULT_MODEL_ROUND_TIMEOUT_MS,
    toolTimeoutMs = DEFAULT_TOOL_EXECUTION_TIMEOUT_MS,
  } = options;

  const config = loadModelConfig();
  const tools = registry.toOpenAITools();
  const workspaceRoot = ensureWorkspaceDir();
  let messages = [...options.messages];
  let rounds = 0;

  try {
  while (rounds < maxRounds) {
    options.onPhaseChange?.('running');
    if (signal?.aborted) {
      yield ev.runError(runId, '已取消', sessionId);
      return;
    }

    rounds += 1;
    options.onModelRoundStart?.(rounds);
    let roundContent: string | null = null;
    let roundToolCalls: OpenAIToolCall[] = [];

    const modelTimeout = createLinkedTimeoutSignal(signal, modelTimeoutMs);
    const modelStream = streamChat(messages, config, {
      tools,
      signal: modelTimeout.signal,
      cacheStablePrefix: options.cacheStablePrefix,
    });
    let modelError: string | null = null;
    const iterator = modelStream[Symbol.asyncIterator]();
    try {
      while (true) {
        let step: IteratorResult<import('../shared/types').ModelEvent>;
        try {
          step = await awaitWithAbort(iterator.next(), modelTimeout.signal);
        } catch (error) {
          modelError = modelTimeout.didTimeout()
            ? '模型请求超时'
            : signal?.aborted
              ? '已取消'
              : error instanceof Error
                ? error.message
                : String(error);
          break;
        }
        if (step.done) break;
        const event = step.value;
        if (event.type === 'text_delta') {
          yield ev.textDelta(runId, event.delta);
        } else if (event.type === 'reasoning_delta') {
          yield ev.reasoningDelta(runId, event.delta);
        } else if (event.type === 'usage') {
          yield ev.usage(runId, event.promptTokens, event.completionTokens, event.cachedTokens);
        } else if (event.type === 'round_complete') {
          roundContent = event.content;
          roundToolCalls = event.toolCalls;
        } else if (event.type === 'error') {
          modelError = modelTimeout.didTimeout()
            ? '模型请求超时'
            : signal?.aborted
              ? '已取消'
              : event.message;
          break;
        }
      }
    } finally {
      if (modelError) {
        try {
          const closing = iterator.return?.(undefined);
          if (closing) void closing.catch(() => undefined);
        } catch {
          // Preserve the original model error.
        }
      }
      modelTimeout.dispose();
      options.onModelRoundEnd?.(
        rounds,
        modelError ? (signal?.aborted ? 'cancelled' : 'failed') : 'succeeded',
        modelError ?? undefined,
      );
    }

    if (modelError) {
      yield ev.runError(runId, modelError, sessionId);
      return;
    }

    if (!roundToolCalls.length) {
      if (signal?.aborted) {
        yield ev.runError(runId, '已取消', sessionId);
      }
      return;
    }

    const assistantMessage: LlmMessage = {
      role: 'assistant',
      content: roundContent,
      tool_calls: roundToolCalls,
    };
    messages = [...messages, assistantMessage];

    const toolCtx: ToolContext = {
      sessionId,
      workspaceRoot,
      signal: signal ?? new AbortController().signal,
      runId,
    };

    for (const toolCall of roundToolCalls) {
      if (signal?.aborted) {
        yield ev.runError(runId, '已取消', sessionId);
        return;
      }

      options.onPhaseChange?.('waiting_tool');
      const callId = toolCall.id || createCallId();
      const parsedArgs = parseToolArgs(toolCall.function.arguments);
      const toolName = toolCall.function.name;

      yield ev.toolCallStart(runId, callId, toolName, parsedArgs.args);

      let result: ToolResult;
      if (parsedArgs.error) {
        result = createToolError(parsedArgs.error, 'invalid_arguments');
      } else {
        const toolTimeout = createLinkedTimeoutSignal(signal, toolTimeoutMs);
        try {
          result = await awaitWithAbort(
            executeToolCall(
              { ...toolCall, id: callId },
              { ...toolCtx, signal: toolTimeout.signal },
              registry,
              policy,
              {
                onPermissionStart: options.onPermissionStart,
                onPermissionEnd: options.onPermissionEnd,
              },
            ),
            toolTimeout.signal,
          );
        } catch (error) {
          result = createToolError(
            toolTimeout.didTimeout()
              ? '工具执行超时'
              : signal?.aborted
                ? '已取消'
                : error instanceof Error
                  ? error.message
                  : String(error),
            toolTimeout.didTimeout()
              ? 'timeout'
              : signal?.aborted
                ? 'cancelled'
                : undefined,
          );
        } finally {
          toolTimeout.dispose();
        }
      }

      yield ev.toolCallEnd(runId, callId, result);

      if (signal?.aborted) {
        yield ev.runError(runId, '已取消', sessionId);
        return;
      }

      if (toolName === 'update_agent_plan' && result.success) {
        yield ev.planUpdated(runId, getRunPlan(runId));
      }

      messages = [
        ...messages,
        {
          role: 'tool',
          tool_call_id: callId,
          content: result.success
            ? result.output
            : `错误: ${result.error ?? '执行失败'}`,
        },
      ];
    }

    options.onPhaseChange?.('running');
  }

  yield ev.runError(runId, `已达到最大工具轮次 (${maxRounds})`, sessionId);
  } finally {
    clearRunPlan(runId);
  }
}
