import type { LlmMessage, OpenAIToolCall } from '../agent/types';
import type { ModelConfig, ModelEvent } from '../shared/types';
import type { OpenAIToolSchema } from '../tools/types';
import { shouldIncludeStreamUsage } from './config';
import { parseCompatibleUsage } from './usage-parse';
import { encodeMessagesForApi } from './message-encode';
import { createModelHttpError, fetchModelResponse } from './http';

interface OpenAIStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
      reasoning_content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id: string;
        type?: string;
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: Record<string, unknown>;
}

type ToolCallAccumulator = Record<
  number,
  { id: string; name: string; arguments: string }
>;

function accumulateToolCallDelta(
  acc: ToolCallAccumulator,
  delta: NonNullable<OpenAIStreamChunk['choices']>[0]['delta'],
): void {
  if (!delta?.tool_calls) return;
  for (const tc of delta.tool_calls) {
    let slot =
      tc.id !== undefined && tc.id !== ''
        ? findSlotById(acc, tc.id)
        : undefined;
    if (slot === undefined) {
      slot = tc.index ?? nextFreeSlot(acc);
    }
    if (!acc[slot]) {
      acc[slot] = { id: '', name: '', arguments: '' };
    }
    if (tc.id) acc[slot].id = tc.id;
    if (tc.function?.name) acc[slot].name = tc.function.name;
    if (tc.function?.arguments) {
      acc[slot].arguments += tc.function.arguments;
    }
  }
}

function findSlotById(acc: ToolCallAccumulator, id: string): number | undefined {
  const hit = Object.entries(acc).find(([, value]) => value.id === id);
  return hit ? Number(hit[0]) : undefined;
}

function nextFreeSlot(acc: ToolCallAccumulator): number {
  const indices = Object.keys(acc).map(Number);
  return indices.length ? Math.max(...indices) + 1 : 0;
}

function toOpenAIToolCalls(acc: ToolCallAccumulator): OpenAIToolCall[] {
  const seenIds = new Set<string>();
  const seenFallback = new Set<string>();

  return Object.keys(acc)
    .map(Number)
    .sort((a, b) => a - b)
    .map((index) => ({
      id: acc[index].id,
      type: 'function' as const,
      function: {
        name: acc[index].name,
        arguments: acc[index].arguments,
      },
    }))
    .filter((tc) => tc.function.name)
    .filter((tc) => {
      if (tc.id) {
        if (seenIds.has(tc.id)) return false;
        seenIds.add(tc.id);
      }

      const fallbackKey = `${tc.function.name}\0${tc.function.arguments}`;
      if (seenFallback.has(fallbackKey)) return false;
      seenFallback.add(fallbackKey);
      return true;
    });
}

function mergeMessageToolCalls(
  acc: ToolCallAccumulator,
  toolCalls: NonNullable<NonNullable<OpenAIStreamChunk['choices']>[0]['message']>['tool_calls'],
): void {
  if (!toolCalls?.length) return;
  toolCalls.forEach((tc, index) => {
    let slot =
      tc.id !== undefined && tc.id !== ''
        ? findSlotById(acc, tc.id)
        : undefined;

    if (slot === undefined) {
      slot = tc.index ?? index;
      if (acc[slot]?.id && tc.id && acc[slot].id !== tc.id) {
        slot = nextFreeSlot(acc);
      }
    }

    if (!acc[slot]) {
      acc[slot] = { id: '', name: '', arguments: '' };
    }
    if (tc.id) acc[slot].id = tc.id;
    if (tc.function?.name) acc[slot].name = tc.function.name;
    if (tc.function?.arguments) acc[slot].arguments = tc.function.arguments;
  });
}

export async function* streamChat(
  messages: LlmMessage[],
  config: ModelConfig,
  options?: {
    tools?: OpenAIToolSchema[];
    signal?: AbortSignal;
    cacheStablePrefix?: string;
    maxOutputTokens?: number;
  },
): AsyncGenerator<ModelEvent> {
  const apiMessages = encodeMessagesForApi(messages, options?.cacheStablePrefix);

  const body: Record<string, unknown> = {
    model: config.model,
    messages: apiMessages,
    stream: true,
  };

  if (options?.tools?.length) {
    body.tools = options.tools;
    body.tool_choice = 'auto';
  }

  if (options?.maxOutputTokens) body.max_tokens = options.maxOutputTokens;

  if (shouldIncludeStreamUsage()) {
    body.stream_options = { include_usage: true };
  }

  const response = await fetchModelResponse(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: options?.signal,
  });

  if (!response.ok) {
    const error = await createModelHttpError(response);
    yield { type: 'error', message: error.message };
    return;
  }

  if (!response.body) {
    yield { type: 'error', message: '响应体为空' };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const toolAcc: ToolCallAccumulator = {};
  let assistantContent = '';
  let stopReason: string | undefined;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;

        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') {
          const toolCalls = toOpenAIToolCalls(toolAcc);
          yield {
            type: 'round_complete',
            content: assistantContent || null,
            toolCalls,
            ...(stopReason ? { stopReason } : {}),
          };
          yield { type: 'done' };
          return;
        }

        let parsed: OpenAIStreamChunk;
        try {
          parsed = JSON.parse(data) as OpenAIStreamChunk;
        } catch {
          continue;
        }

        const delta = parsed.choices?.[0]?.delta;
        stopReason = parsed.choices?.[0]?.finish_reason ?? stopReason;
        const message = parsed.choices?.[0]?.message;

        if (delta?.reasoning_content) {
          yield { type: 'reasoning_delta', delta: delta.reasoning_content };
        }

        if (delta?.content) {
          assistantContent += delta.content;
          yield { type: 'text_delta', delta: delta.content };
        }

        accumulateToolCallDelta(toolAcc, delta);
        mergeMessageToolCalls(toolAcc, message?.tool_calls);

        if (message?.content && !delta?.content) {
          const remainder = message.content.slice(assistantContent.length);
          if (remainder) {
            assistantContent += remainder;
            yield { type: 'text_delta', delta: remainder };
          }
        }

        if (parsed.usage) {
          const usage = parseCompatibleUsage(parsed.usage);
          yield { type: 'usage', ...usage };
        }
      }
    }

    const toolCalls = toOpenAIToolCalls(toolAcc);
    yield {
      type: 'round_complete',
      content: assistantContent || null,
      toolCalls,
      ...(stopReason ? { stopReason } : {}),
    };
    yield { type: 'done' };
  } catch (err) {
    if (options?.signal?.aborted) {
      yield { type: 'error', message: '已取消' };
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    yield { type: 'error', message };
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The stream may already be closed or aborted.
    }
    try {
      reader.releaseLock();
    } catch {
      // Ignore readers already detached by the runtime.
    }
  }
}
