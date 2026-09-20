import type { LlmMessage, OpenAIToolCall, PermissionPolicy } from './types';
import { createCallId, ev } from './events';
import { getRunPlan, clearRunPlan, markRunPlanWaitingUser } from './plan-state';
import { ASK_USER_TOOL_NAME } from '../tools/interaction/ask-user';
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
import { canonicalCallSignature, DEFAULT_EXECUTION_LIMITS, estimateRequestTokens, positiveLimit } from './execution-limits';
import { finalizeStoppedRun, type StopSummary } from './run-finalization';
import { CheckpointTracker } from './checkpoint-tracker';
import type { RunCheckpoint } from './checkpoint-contract';

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
  onPhaseChange?: (phase: 'running' | 'waiting_tool' | 'finalizing') => void;
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
  /** P6.1：ask_user 开始等待用户回答 / 结束等待（运行阶段 waiting_user） */
  onQuestionStart?: () => void;
  onQuestionEnd?: (status: 'succeeded' | 'failed' | 'cancelled', errorMessage?: string) => void;
  modelTimeoutMs?: number;
  toolTimeoutMs?: number;
  modelRuntime?: ModelRuntimeConfig;
  toolResultContextBudgetTokens?: number;
  maxToolCallsPerRound?: number;
  maxToolCalls?: number;
  maxActiveMs?: number;
  maxTotalTokens?: number;
  maxInputTokens?: number;
  questionTimeoutMs?: number;
  checkpoint?: { goal: string; environment: string; previous?: RunCheckpoint; save: (snapshot: RunCheckpoint) => void };
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
  return canonicalCallSignature(toolCall.function.name, toolCall.function.arguments);
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
  hooks?: Pick<AgentLoopOptions, 'onPermissionStart' | 'onPermissionEnd'> & { onUserWaitElapsed?: (ms: number) => void; requireFreshApproval?: boolean },
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
  const policyDecision = checkPermission(tool, policy, args);
  const decision = hooks?.requireFreshApproval && contract.risk !== 'read' && policyDecision !== 'deny'
    ? 'confirm' : policyDecision;
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
    const waitStartedAt = Date.now();
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
    } finally {
      hooks?.onUserWaitElapsed?.(Date.now() - waitStartedAt);
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
  return enforceToolEvidence(result, call.contract, ctx.workspaceRoot, { verifyDigest: true });
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
    maxRounds: requestedRounds,
    policy = defaultPermissionPolicy(),
    signal,
    modelTimeoutMs = DEFAULT_MODEL_ROUND_TIMEOUT_MS,
    toolTimeoutMs = DEFAULT_TOOL_EXECUTION_TIMEOUT_MS,
    toolResultContextBudgetTokens = DEFAULT_TOOL_RESULT_CONTEXT_BUDGET_TOKENS,
    maxToolCallsPerRound: requestedCallsPerRound,
  } = options;

  const modelRuntime = options.modelRuntime ?? loadModelRuntimeConfig();
  const config = modelRuntime;
  const tools = registry.toOpenAITools();
  const workspaceRoot = ensureWorkspaceDir();
  const maxRounds = positiveLimit(requestedRounds, DEFAULT_EXECUTION_LIMITS.rounds);
  const maxToolCallsPerRound = positiveLimit(requestedCallsPerRound, DEFAULT_MAX_TOOL_CALLS_PER_ROUND);
  const maxToolCalls = positiveLimit(options.maxToolCalls, DEFAULT_EXECUTION_LIMITS.toolCalls);
  const maxActiveMs = positiveLimit(options.maxActiveMs, DEFAULT_EXECUTION_LIMITS.activeMs);
  const maxTotalTokens = positiveLimit(options.maxTotalTokens, DEFAULT_EXECUTION_LIMITS.tokens);
  const maxInputTokens = positiveLimit(options.maxInputTokens ?? 24_000, 256_000);
  const startedAt = Date.now();
  let userWaitMs = 0;
  let totalTokens = 0;
  let toolCalls = 0;
  const summary: StopSummary = {
    reason: 'budget_exhausted', message: `已达到本段模型工作轮次预算 (${maxRounds})`,
    facts: [], pending: [], succeeded: 0, failed: 0,
  };
  const activeRemaining = () => Math.max(0, maxActiveMs - (Date.now() - startedAt - userWaitMs));
  let messages = [...options.messages];
  let rounds = 0;
  let issuedRounds = 0;
  const completedToolCalls = new Map<string, CompletedToolCall>();
  /** 非幂等副作用工具在本轮 run 内已成功执行过的调用签名 → 首次结果 */
  const completedSideEffects = new Map<string, ToolResult>();
  const checkpoint = options.checkpoint;
  const tracker = checkpoint ? new CheckpointTracker(workspaceRoot, checkpoint.previous) : undefined;
  const repeatedFailures = new Map<string, number>();

  try {
  work: while (rounds < maxRounds) {
    options.onPhaseChange?.('running');
    if (signal?.aborted) {
      yield ev.runError(runId, '已取消', sessionId);
      return;
    }

    rounds += 1;
    messages = compactToolResults(messages, toolResultContextBudgetTokens);
    const estimatedInput = estimateRequestTokens(messages, tools);
    // 预留一份有界收尾输入及输出，不能把全部额度耗在业务请求上。
    const finalReserve = 7000;
    if (estimatedInput > maxInputTokens || totalTokens + estimatedInput
        + DEFAULT_EXECUTION_LIMITS.outputTokens + finalReserve > maxTotalTokens || activeRemaining() <= 0) {
      summary.message = estimatedInput > maxInputTokens ? '完整模型输入达到上下文预算'
        : activeRemaining() <= 0 ? '已达到本段主动执行时间预算' : '已达到本段累计 token 预算';
      break;
    }
    options.onModelRoundStart?.(rounds);
    issuedRounds += 1;
    let roundContent: string | null = null;
    let roundToolCalls: OpenAIToolCall[] = [];
    let outputTruncated = false;

    let roundUsage = 0;
    let estimatedOutput = 0;
    const modelTimeout = createLinkedTimeoutSignal(signal, Math.min(modelTimeoutMs, activeRemaining()));
    const modelStream = streamChat(messages, config, {
      tools,
      signal: modelTimeout.signal,
      cacheStablePrefix: options.cacheStablePrefix,
      protocol: modelRuntime.protocol,
      maxOutputTokens: DEFAULT_EXECUTION_LIMITS.outputTokens,
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
          estimatedOutput += estimateTokens(event.delta);
          yield ev.textDelta(runId, event.delta);
        } else if (event.type === 'reasoning_delta') {
          estimatedOutput += estimateTokens(event.delta);
          yield ev.reasoningDelta(runId, event.delta);
        } else if (event.type === 'usage') {
          roundUsage = Math.max(roundUsage, event.promptTokens + event.completionTokens);
          yield ev.usage(runId, event.promptTokens, event.completionTokens, event.cachedTokens);
        } else if (event.type === 'round_complete') {
          roundContent = event.content;
          roundToolCalls = event.toolCalls;
          outputTruncated = event.stopReason === 'length' || event.stopReason === 'max_tokens';
          estimatedOutput = Math.max(estimatedOutput, estimateTokens(JSON.stringify(event)));
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
      totalTokens += Math.max(roundUsage, estimatedInput + estimatedOutput);
      options.onModelRoundEnd?.(
        rounds,
        modelError ? (signal?.aborted ? 'cancelled' : 'failed') : 'succeeded',
        modelError ?? undefined,
      );
    }

    if (modelError) {
      if (!signal?.aborted && activeRemaining() <= 0) {
        summary.message = '已达到本段主动执行时间预算';
        break;
      }
      yield ev.runError(runId, modelError, sessionId);
      return;
    }

    roundToolCalls = normalizeRoundToolCalls(roundToolCalls);

    if (outputTruncated) {
      summary.message = '模型输出达到长度上限，本次输出不完整，未执行其中的工具调用';
      break;
    }

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

      if (toolCalls >= maxToolCalls || activeRemaining() <= 0) {
        summary.message = toolCalls >= maxToolCalls ? `已达到本段工具调用预算 (${maxToolCalls})` : '已达到本段主动执行时间预算';
        summary.pending.push(`未执行：${toolName}（及本批后续调用）`);
        break work;
      }
      toolCalls += 1;

      yield ev.toolCallStart(runId, callId, toolName, parsedArgs.args);

      let result: ToolResult;
      let executed = false;
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
      } else if (tracker?.blocks(toolName, toolCall.function.arguments)) {
        result = createToolError('此前执行段已成功执行此副作用，禁止重放；请复用已有结果并检查下一步', 'permission_denied');
      } else {
        // ask_user：等待期间运行阶段切到 waiting_user，正在进行的计划项标为"等用户"
        const askingUser = toolName === ASK_USER_TOOL_NAME && registeredTool !== undefined;
        const questionStartedAt = askingUser ? Date.now() : undefined;
        if (askingUser) {
          options.onQuestionStart?.();
          if (markRunPlanWaitingUser(runId, true)) yield ev.planUpdated(runId, getRunPlan(runId));
        }
        let authorized: AuthorizedToolCall | ToolResult;
        try {
          authorized = await authorizeToolCall(
            { ...toolCall, id: callId },
            toolCtx,
            registry,
            policy,
            Math.min(toolTimeoutMs, Math.max(1, activeRemaining())),
            {
              onPermissionStart: options.onPermissionStart,
              onPermissionEnd: options.onPermissionEnd,
              onUserWaitElapsed: (ms) => { if (!askingUser) userWaitMs += ms; },
              requireFreshApproval: Boolean(checkpoint?.previous),
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
        } else if (!askingUser && activeRemaining() <= 0) {
          result = createToolError('本段执行时间预算已耗尽，未启动工具执行', 'timeout');
        } else {
          await tracker?.before(parsedArgs.args);
          executed = true;
          const toolTimeout = createLinkedTimeoutSignal(signal, askingUser
            ? positiveLimit(options.questionTimeoutMs, 10 * 60_000)
            : Math.min(toolTimeoutMs, Math.max(1, activeRemaining())));
          try {
            result = await awaitWithAbort(
              executeAuthorizedTool(authorized, { ...toolCtx, signal: toolTimeout.signal }),
              toolTimeout.signal,
            );
          } catch (error) {
            const sideEffecting = registeredTool
              ? resolveCallContract(registeredTool, parsedArgs.args).risk !== 'read'
              : true;
            const timedOutOrCancelled = toolTimeout.didTimeout() || Boolean(signal?.aborted);
            const outcomeUnknown = sideEffecting && timedOutOrCancelled;
            result = createToolError(
              outcomeUnknown
                ? '副作用工具已启动，但在超时或取消后仍未可靠收口，当前结果未知；请先核对目标状态，暂勿重试同一操作'
                : toolTimeout.didTimeout()
                  ? '工具执行超时'
                  : signal?.aborted
                    ? '已取消'
                    : error instanceof Error
                      ? error.message
                      : String(error),
              outcomeUnknown
                ? 'outcome_unknown'
                : toolTimeout.didTimeout()
                  ? 'timeout'
                  : signal?.aborted
                    ? 'cancelled'
                    : undefined,
            );
          } finally {
            toolTimeout.dispose();
          }
        }
        if (askingUser) {
          userWaitMs += Date.now() - questionStartedAt!;
          options.onQuestionEnd?.(
            result.success ? 'succeeded' : result.errorCategory === 'cancelled' ? 'cancelled' : 'failed',
            result.success ? undefined : result.error,
          );
          if (markRunPlanWaitingUser(runId, false)) yield ev.planUpdated(runId, getRunPlan(runId));
        }
      }

      if (!completed) {
        completedToolCalls.set(callId, { signature, result });
        if (suppressDuplicates && result.success && !priorSideEffect) {
          completedSideEffects.set(signature, result);
        }
      }

      yield ev.toolCallEnd(runId, callId, result);
      if (executed) await tracker?.after(toolName, toolCall.function.arguments, result, Boolean(suppressDuplicates),
        registeredTool ? resolveCallContract(registeredTool, parsedArgs.args).risk !== 'read' : true);

      if (!completed && !priorSideEffect) {
        if (result.success) summary.succeeded += 1;
        else summary.failed += 1;
        summary.facts.unshift(`${toolName}：${result.success ? '成功' : '失败'} — ${formatToolResultForModel(result, 200)}`);
        if (result.success && registeredTool && resolveCallContract(registeredTool, parsedArgs.args).evidence === 'artifact') {
          for (const artifact of result.artifacts ?? []) {
            summary.facts.unshift(`已验证产物：${artifact.relativePath}（${artifact.size} 字节）`);
          }
        }
      }

      if (signal?.aborted) {
        if (result.errorCategory === 'outcome_unknown') {
          yield ev.runError(runId, result.error ?? '副作用结果未知，请先核对目标状态', sessionId);
        } else {
          yield ev.runError(runId, '已取消', sessionId);
        }
        return;
      }

      if (result.errorCategory === 'outcome_unknown') {
        summary.reason = 'outcome_unknown';
        summary.message = '有副作用工具在超时或取消后无法确认最终结果，已停止后续操作以避免重复执行';
        summary.pending.push(`先核对 ${toolName} 的目标状态，再决定是否重试`);
        break work;
      }

      if (toolName === ASK_USER_TOOL_NAME && !result.success) {
        summary.reason = 'awaiting_input';
        summary.message = '尚未收到必要回答，已停止本批后续操作';
        summary.pending.push('请补充或重新确认尚未回答的问题');
        break work;
      }

      if (!result.success) {
        const failures = (repeatedFailures.get(signature) ?? 0) + 1;
        repeatedFailures.set(signature, failures);
        if (failures >= 3) {
          summary.reason = 'repeated_failure';
          summary.message = `相同工具和参数连续失败或重放失败结果 3 次 (${toolName})，已停止重复尝试`;
          summary.pending.push('需要修正失败原因后重新确认下一步');
          break work;
        }
        if (failures === 2) result = { ...result, error: `${result.error ?? '执行失败'}；相同请求已失败两次，请修正参数或换一种方法，不要重复调用` };
      } else {
        repeatedFailures.delete(signature);
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

  options.onPhaseChange?.('finalizing');
  summary.pending.push(...getRunPlan(runId).filter((item) => item.status !== 'completed' && item.status !== 'cancelled')
    .map((item) => item.content));
  let finalUsage = 0;
  for await (const event of finalizeStoppedRun({
    runId, sessionId, summary, signal, runtime: modelRuntime,
    goal: options.messages.filter((message) => message.role === 'user').at(-1)?.content ?? '',
    timeoutMs: Math.min(modelTimeoutMs, 30_000), maxInputTokens,
    remainingTokens: Math.max(0, maxTotalTokens - totalTokens),
  })) {
    if (event.type === 'usage') finalUsage = Math.max(finalUsage, event.promptTokens + event.completionTokens);
    if (event.type === 'run_error' && event.reason === 'budget_exhausted' && checkpoint && tracker && !signal?.aborted) {
      try {
        const previous = checkpoint.previous;
        checkpoint.save(tracker.snapshot({
          rootRunId: previous?.rootRunId ?? runId, goal: checkpoint.goal, environment: checkpoint.environment,
          facts: [...summary.facts, ...previous?.facts ?? []].slice(0, 150), pending: summary.pending,
          totals: {
            rounds: issuedRounds + (previous?.totals.rounds ?? 0), toolCalls: toolCalls + (previous?.totals.toolCalls ?? 0),
            tokens: totalTokens + Math.max(finalUsage, 7000) + (previous?.totals.tokens ?? 0),
            activeMs: Date.now() - startedAt - userWaitMs + (previous?.totals.activeMs ?? 0),
            segments: 1 + (previous?.totals.segments ?? 0),
          },
        }));
        yield ev.textDelta(runId, '\n检查点已保存。可在本次运行详情中确认额度并继续一段；普通发送消息仍是新任务。');
      } catch {
        yield ev.textDelta(runId, '\n本次未能建立可安全继续的检查点，请核对已有产物后重新确认任务。');
      }
    }
    yield event;
  }
  } finally {
    clearRunPlan(runId);
  }
}
