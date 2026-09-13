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
import {
  loadModelRuntimeConfig,
  type ModelRuntimeConfig,
} from '../models/config';
import { streamChat } from '../models/stream-chat';
import type { ToolRegistry } from '../tools/registry';
import type {
  ToolContext,
  ToolDefinition,
  ToolResult,
  ToolSideEffectContract,
} from '../tools/types';
import { createToolError, normalizeToolResult } from '../tools/result';
import { resolveCallContract, shouldSuppressDuplicateCall } from '../tools/contract';
import { enforceToolEvidence } from '../tools/evidence';
import { awaitWithAbort, createLinkedTimeoutSignal } from './abort';
import { estimateTokens, truncateToTokenBudget } from './context-budget';

export const DEFAULT_MODEL_ROUND_TIMEOUT_MS = 120_000;
export const DEFAULT_TOOL_EXECUTION_TIMEOUT_MS = 120_000;
export const DEFAULT_TOOL_RESULT_CONTEXT_BUDGET_TOKENS = 8_000;
export const DEFAULT_MAX_TOOL_CALLS_PER_ROUND = 20;
const OMITTED_TOOL_RESULT = '[较早工具结果已省略]';
const DUPLICATE_SIDE_EFFECT_NOTE =
  '[重复调用已合并] 本轮此前已用完全相同的参数成功执行过该工具，为避免重复副作用未再次执行；以下为首次执行的结果。';

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
  modelRuntime?: ModelRuntimeConfig;
  toolResultContextBudgetTokens?: number;
  maxToolCallsPerRound?: number;
}

interface CompletedToolCall {
  signature: string;
  result: ToolResult;
}

function normalizeRoundToolCalls(toolCalls: OpenAIToolCall[]): OpenAIToolCall[] {
  const seen = new Set<string>();
  const normalized: OpenAIToolCall[] = [];

  for (const toolCall of toolCalls) {
    const id = toolCall.id || createCallId();
    if (seen.has(id)) continue;
    seen.add(id);
    normalized.push({ ...toolCall, id });
  }

  return normalized;
}

function toolCallSignature(toolCall: OpenAIToolCall): string {
  return `${toolCall.function.name}\0${toolCall.function.arguments}`;
}

function formatToolResultForModel(result: ToolResult, maxTokens: number): string {
  const content = result.success
    ? result.output
    : `错误: ${result.error ?? '执行失败'}`;
  return truncateToTokenBudget(content, Math.max(1, maxTokens));
}

function compactToolResults(
  messages: LlmMessage[],
  maxTokens: number,
): LlmMessage[] {
  const toolIndexes = messages
    .map((message, index) => message.role === 'tool' ? index : -1)
    .filter((index) => index >= 0);
  if (!toolIndexes.length) return messages;

  const limit = Math.max(1, Math.floor(maxTokens));
  const markerTokens = estimateTokens(OMITTED_TOOL_RESULT);
  let remaining = Math.max(0, limit - markerTokens * toolIndexes.length);
  const compacted = [...messages];

  for (let cursor = toolIndexes.length - 1; cursor >= 0; cursor -= 1) {
    const index = toolIndexes[cursor];
    const message = messages[index];
    if (message.role !== 'tool') continue;

    const originalTokens = estimateTokens(message.content);
    if (remaining <= 0) {
      compacted[index] = { ...message, content: OMITTED_TOOL_RESULT };
      continue;
    }

    const allowed = markerTokens + remaining;
    const content = originalTokens <= allowed
      ? message.content
      : truncateToTokenBudget(message.content, allowed);
    remaining -= Math.max(0, estimateTokens(content) - markerTokens);
    compacted[index] = { ...message, content };
  }

  return compacted;
}

function parseToolArgs(raw: string): { args: unknown; error?: string } {
  try {
    return { args: JSON.parse(raw || '{}') };
  } catch {
    return { args: null, error: '工具参数 JSON 解析失败' };
  }
}

interface AuthorizedToolCall {
  tool: ToolDefinition;
  args: unknown;
  contract: ToolSideEffectContract;
  previewRevision?: string;
}

function isToolResult(value: AuthorizedToolCall | ToolResult): value is ToolResult {
  return 'success' in value;
}

/**
 * 解析参数并完成权限判定/用户确认。这一步只受 run 取消信号约束，
 * 不计入工具执行超时：用户确认窗口允许 5 分钟，不能被 120 秒工具超时中断。
 */
async function authorizeToolCall(
  toolCall: OpenAIToolCall,
  ctx: ToolContext,
  registry: ToolRegistry,
  policy: PermissionPolicy,
  previewTimeoutMs: number,
  hooks?: Pick<AgentLoopOptions, 'onPermissionStart' | 'onPermissionEnd'>,
): Promise<AuthorizedToolCall | ToolResult> {
  const tool = registry.get(toolCall.function.name);
  if (!tool) {
    return createToolError(`未知工具: ${toolCall.function.name}`, 'internal_error');
  }

  const parsed = parseToolArgs(toolCall.function.arguments);
  if (parsed.error) {
    return createToolError(parsed.error, 'invalid_arguments');
  }

  const args = parsed.args;
  const contract = resolveCallContract(tool, args);
  const decision = checkPermission(tool, policy, args);
  let previewRevision: string | undefined;

  if (decision === 'deny') {
    return createToolError(
      `权限被拒绝: ${toolCall.function.name}`,
      'permission_denied',
    );
  }

  if (decision === 'confirm') {
    const activityId = hooks?.onPermissionStart?.(tool.name);
    let preview: ToolResult['preview'];
    if (contract.supportsPreview) {
      const previewTimeout = createLinkedTimeoutSignal(ctx.signal, previewTimeoutMs);
      let previewResult: ToolResult;
      try {
        previewResult = normalizeToolResult(await awaitWithAbort(
          tool.execute(args, {
            ...ctx,
            signal: previewTimeout.signal,
            preview: true,
            previewRevision: undefined,
          }),
          previewTimeout.signal,
        ));
      } catch (error) {
        previewResult = createToolError(
          previewTimeout.didTimeout()
            ? '操作预览生成超时'
            : ctx.signal.aborted
              ? '已取消'
              : error instanceof Error
                ? error.message
                : String(error),
          previewTimeout.didTimeout()
            ? 'timeout'
            : ctx.signal.aborted
              ? 'cancelled'
              : undefined,
        );
      } finally {
        previewTimeout.dispose();
      }

      if (!previewResult.success) {
        if (activityId) {
          hooks?.onPermissionEnd?.(
            activityId,
            previewResult.errorCategory === 'cancelled' ? 'cancelled' : 'failed',
            previewResult.error ?? '操作预览生成失败',
          );
        }
        return previewResult;
      }
      if (!previewResult.preview || previewResult.artifacts?.length) {
        const invalidPreview = createToolError(
          previewResult.artifacts?.length
            ? '工具预览违反无副作用契约：预览阶段产生了文件产物'
            : '工具声明支持预览，但未返回结构化预览',
          'internal_error',
        );
        if (activityId) {
          hooks?.onPermissionEnd?.(activityId, 'failed', invalidPreview.error);
        }
        return invalidPreview;
      }
      preview = previewResult.preview;
      previewRevision = preview.revision;
    }

    let approved: boolean;
    try {
      approved = await confirmPermission(tool.name, args, ctx.signal, {
        runId: ctx.runId,
        sessionId: ctx.sessionId,
        risk: contract.risk,
        preview,
      });
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

  return { tool, args, contract, previewRevision };
}

async function executeAuthorizedTool(
  call: AuthorizedToolCall,
  ctx: ToolContext,
): Promise<ToolResult> {
  const result = normalizeToolResult(await call.tool.execute(call.args, {
    ...ctx,
    preview: false,
    previewRevision: call.previewRevision,
  }));
  // 闭环第 5 步"验证"：声明产生文件产物的工具必须能读回产物，否则不算完成。
  return enforceToolEvidence(result, call.contract, ctx.workspaceRoot);
}

function markDuplicateSideEffect(prior: ToolResult): ToolResult {
  return {
    ...prior,
    output: prior.output ? `${DUPLICATE_SIDE_EFFECT_NOTE}\n${prior.output}` : DUPLICATE_SIDE_EFFECT_NOTE,
    metadata: { ...prior.metadata, duplicateSuppressed: true },
  };
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
    toolResultContextBudgetTokens = DEFAULT_TOOL_RESULT_CONTEXT_BUDGET_TOKENS,
    maxToolCallsPerRound = DEFAULT_MAX_TOOL_CALLS_PER_ROUND,
  } = options;

  const modelRuntime = options.modelRuntime ?? loadModelRuntimeConfig();
  const config = modelRuntime;
  const tools = registry.toOpenAITools();
  const workspaceRoot = ensureWorkspaceDir();
  let messages = [...options.messages];
  let rounds = 0;
  const completedToolCalls = new Map<string, CompletedToolCall>();
  /** 非幂等副作用工具在本轮 run 内已成功执行过的调用签名 → 首次结果 */
  const completedSideEffects = new Map<string, ToolResult>();

  try {
  while (rounds < maxRounds) {
    options.onPhaseChange?.('running');
    if (signal?.aborted) {
      yield ev.runError(runId, '已取消', sessionId);
      return;
    }

    rounds += 1;
    messages = compactToolResults(messages, toolResultContextBudgetTokens);
    options.onModelRoundStart?.(rounds);
    let roundContent: string | null = null;
    let roundToolCalls: OpenAIToolCall[] = [];

    const modelTimeout = createLinkedTimeoutSignal(signal, modelTimeoutMs);
    const modelStream = streamChat(messages, config, {
      tools,
      signal: modelTimeout.signal,
      cacheStablePrefix: options.cacheStablePrefix,
      protocol: modelRuntime.protocol,
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

    roundToolCalls = normalizeRoundToolCalls(roundToolCalls);

    if (roundToolCalls.length > Math.max(1, Math.floor(maxToolCallsPerRound))) {
      yield ev.runError(
        runId,
        `单轮工具调用超过安全限制 (${maxToolCallsPerRound})`,
        sessionId,
      );
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
      const callId = toolCall.id;
      const parsedArgs = parseToolArgs(toolCall.function.arguments);
      const toolName = toolCall.function.name;
      const signature = toolCallSignature(toolCall);

      yield ev.toolCallStart(runId, callId, toolName, parsedArgs.args);

      let result: ToolResult;
      const completed = completedToolCalls.get(callId);
      const registeredTool = registry.get(toolName);
      const suppressDuplicates = registeredTool && !parsedArgs.error
        ? shouldSuppressDuplicateCall(resolveCallContract(registeredTool, parsedArgs.args))
        : false;
      const priorSideEffect = suppressDuplicates ? completedSideEffects.get(signature) : undefined;
      if (completed?.signature === signature) {
        result = {
          ...completed.result,
          metadata: {
            ...completed.result.metadata,
            replayedToolCall: true,
          },
        };
      } else if (completed) {
        result = createToolError(
          '模型重复使用了相同的工具调用编号，但名称或参数不同；已拒绝重复执行',
          'invalid_arguments',
        );
      } else if (parsedArgs.error) {
        result = createToolError(parsedArgs.error, 'invalid_arguments');
      } else if (priorSideEffect) {
        result = markDuplicateSideEffect(priorSideEffect);
      } else {
        let authorized: AuthorizedToolCall | ToolResult;
        try {
          authorized = await authorizeToolCall(
            { ...toolCall, id: callId },
            toolCtx,
            registry,
            policy,
            toolTimeoutMs,
            {
              onPermissionStart: options.onPermissionStart,
              onPermissionEnd: options.onPermissionEnd,
            },
          );
        } catch (error) {
          authorized = createToolError(
            signal?.aborted ? '已取消' : error instanceof Error ? error.message : String(error),
            signal?.aborted ? 'cancelled' : undefined,
          );
        }

        if (isToolResult(authorized)) {
          result = authorized;
        } else {
          const toolTimeout = createLinkedTimeoutSignal(signal, toolTimeoutMs);
          try {
            result = await awaitWithAbort(
              executeAuthorizedTool(authorized, { ...toolCtx, signal: toolTimeout.signal }),
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
      }

      if (!completed) {
        completedToolCalls.set(callId, { signature, result });
        if (suppressDuplicates && result.success && !priorSideEffect) {
          completedSideEffects.set(signature, result);
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
          content: formatToolResultForModel(
            result,
            Math.max(
              256,
              Math.floor(toolResultContextBudgetTokens / roundToolCalls.length),
            ),
          ),
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
