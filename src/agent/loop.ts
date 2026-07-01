import type { LlmMessage, OpenAIToolCall, PermissionPolicy } from './types';
import { createCallId, ev } from './events';
import type { AgUiEvent } from './types';
import {
  checkPermission,
  confirmPermission,
  defaultPermissionPolicy,
  ensureWorkspaceDir,
} from './permissions';
import { loadModelConfig } from '../models/config';
import { streamChat } from '../models/stream-chat';
import type { ToolRegistry } from '../tools/registry';
import type { ToolContext, ToolResult } from '../tools/types';

export interface AgentLoopOptions {
  sessionId: string;
  runId: string;
  messages: LlmMessage[];
  registry: ToolRegistry;
  maxRounds?: number;
  policy?: PermissionPolicy;
  signal?: AbortSignal;
  cacheStablePrefix?: string;
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
): Promise<ToolResult> {
  const tool = registry.get(toolCall.function.name);
  if (!tool) {
    return {
      success: false,
      output: '',
      error: `未知工具: ${toolCall.function.name}`,
    };
  }

  const parsed = parseToolArgs(toolCall.function.arguments);
  if (parsed.error) {
    return {
      success: false,
      output: '',
      error: parsed.error,
    };
  }

  const args = parsed.args;
  const decision = checkPermission(tool, policy, args);

  if (decision === 'deny') {
    return {
      success: false,
      output: '',
      error: `权限被拒绝: ${toolCall.function.name}`,
    };
  }

  if (decision === 'confirm') {
    const approved = await confirmPermission(tool.name, args);
    if (!approved) {
      return {
        success: false,
        output: '',
        error: '用户拒绝了此操作',
      };
    }
  }

  return tool.execute(args, ctx);
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
  } = options;

  const config = loadModelConfig();
  const tools = registry.toOpenAITools();
  const workspaceRoot = ensureWorkspaceDir();
  let messages = [...options.messages];
  let rounds = 0;

  while (rounds < maxRounds) {
    if (signal?.aborted) {
      yield ev.runError(runId, '已取消', sessionId);
      return;
    }

    rounds += 1;
    let roundContent: string | null = null;
    let roundToolCalls: OpenAIToolCall[] = [];

    for await (const event of streamChat(messages, config, {
      tools,
      signal,
      cacheStablePrefix: options.cacheStablePrefix,
    })) {
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
        yield ev.runError(runId, event.message, sessionId);
        return;
      }
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
    };

    for (const toolCall of roundToolCalls) {
      const callId = toolCall.id || createCallId();
      const parsedArgs = parseToolArgs(toolCall.function.arguments);

      yield ev.toolCallStart(runId, callId, toolCall.function.name, parsedArgs.args);

      const result = parsedArgs.error
        ? { success: false as const, output: '', error: parsedArgs.error }
        : await executeToolCall(
            { ...toolCall, id: callId },
            toolCtx,
            registry,
            policy,
          );

      yield ev.toolCallEnd(runId, callId, result);

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
  }

  yield ev.runError(runId, `已达到最大工具轮次 (${maxRounds})`, sessionId);
}
