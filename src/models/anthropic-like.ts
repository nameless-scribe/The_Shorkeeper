import type { LlmMessage, OpenAIToolCall } from '../agent/types';
import type { ModelConfig, ModelEvent } from '../shared/types';
import type { OpenAIToolSchema } from '../tools/types';

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string };

interface AnthropicStreamEvent {
  type: string;
  index?: number;
  content_block?: { type: string; text?: string; id?: string; name?: string };
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
    stop_reason?: string;
  };
  message?: {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

type ToolUseAccumulator = Record<
  number,
  { id: string; name: string; arguments: string }
>;

function convertTools(tools: OpenAIToolSchema[]) {
  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters ?? { type: 'object', properties: {} },
  }));
}

function convertMessages(messages: LlmMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string | AnthropicContentBlock[] }>;
} {
  let system: string | undefined;
  const out: Array<{ role: 'user' | 'assistant'; content: string | AnthropicContentBlock[] }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = system ? `${system}\n\n${msg.content}` : msg.content;
      continue;
    }

    if (msg.role === 'user') {
      out.push({ role: 'user', content: msg.content });
      continue;
    }

    if (msg.role === 'assistant') {
      const blocks: AnthropicContentBlock[] = [];
      if (msg.content) blocks.push({ type: 'text', text: msg.content });
      for (const tc of msg.tool_calls ?? []) {
        let input: unknown = {};
        try {
          input = JSON.parse(tc.function.arguments || '{}');
        } catch {
          input = {};
        }
        blocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input,
        });
      }
      out.push({ role: 'assistant', content: blocks.length ? blocks : '' });
      continue;
    }

    if (msg.role === 'tool') {
      out.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: msg.tool_call_id,
            content: msg.content,
          },
        ],
      });
    }
  }

  return { system, messages: out };
}

function toOpenAIToolCalls(acc: ToolUseAccumulator): OpenAIToolCall[] {
  return Object.keys(acc)
    .map(Number)
    .sort((a, b) => a - b)
    .map((index) => ({
      id: acc[index].id,
      type: 'function' as const,
      function: {
        name: acc[index].name,
        arguments: acc[index].arguments || '{}',
      },
    }))
    .filter((tc) => tc.id && tc.function.name);
}

export async function* streamChatAnthropic(
  messages: LlmMessage[],
  config: ModelConfig,
  options?: {
    tools?: OpenAIToolSchema[];
    signal?: AbortSignal;
  },
): AsyncGenerator<ModelEvent> {
  const { system, messages: anthropicMessages } = convertMessages(messages);

  const body: Record<string, unknown> = {
    model: config.model,
    max_tokens: 8192,
    messages: anthropicMessages,
    stream: true,
  };

  if (system) body.system = system;
  if (options?.tools?.length) {
    body.tools = convertTools(options.tools);
  }

  const response = await fetch(`${config.baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: options?.signal,
  });

  if (!response.ok) {
    const text = await response.text();
    yield { type: 'error', message: `API ${response.status}: ${text}` };
    return;
  }

  if (!response.body) {
    yield { type: 'error', message: '响应体为空' };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let assistantContent = '';
  const toolAcc: ToolUseAccumulator = {};
  let roundUsage = { promptTokens: 0, completionTokens: 0, cachedTokens: 0 };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === '[DONE]') continue;

        let parsed: AnthropicStreamEvent;
        try {
          parsed = JSON.parse(data) as AnthropicStreamEvent;
        } catch {
          continue;
        }

        if (parsed.type === 'content_block_start' && parsed.content_block) {
          const index = parsed.index ?? 0;
          if (parsed.content_block.type === 'tool_use') {
            toolAcc[index] = {
              id: parsed.content_block.id ?? '',
              name: parsed.content_block.name ?? '',
              arguments: '',
            };
          }
        }

        if (parsed.type === 'content_block_delta' && parsed.delta) {
          if (parsed.delta.type === 'text_delta' && parsed.delta.text) {
            assistantContent += parsed.delta.text;
            yield { type: 'text_delta', delta: parsed.delta.text };
          }
          if (parsed.delta.type === 'input_json_delta' && parsed.delta.partial_json) {
            const index = parsed.index ?? 0;
            if (!toolAcc[index]) {
              toolAcc[index] = { id: '', name: '', arguments: '' };
            }
            toolAcc[index].arguments += parsed.delta.partial_json;
          }
        }

        if (parsed.type === 'message_delta' && parsed.usage) {
          roundUsage.completionTokens = parsed.usage.output_tokens ?? roundUsage.completionTokens;
        }

        if (parsed.type === 'message_start' && parsed.message?.usage) {
          roundUsage.promptTokens = parsed.message.usage.input_tokens ?? 0;
          roundUsage.cachedTokens = parsed.message.usage.cache_read_input_tokens ?? 0;
        }

        if (parsed.type === 'message_stop') {
          if (roundUsage.promptTokens > 0 || roundUsage.completionTokens > 0) {
            yield {
              type: 'usage',
              promptTokens: roundUsage.promptTokens,
              completionTokens: roundUsage.completionTokens,
              cachedTokens: roundUsage.cachedTokens,
            };
          }
          const toolCalls = toOpenAIToolCalls(toolAcc);
          yield {
            type: 'round_complete',
            content: assistantContent || null,
            toolCalls,
          };
          yield { type: 'done' };
          return;
        }
      }
    }

    const toolCalls = toOpenAIToolCalls(toolAcc);
    yield {
      type: 'round_complete',
      content: assistantContent || null,
      toolCalls,
    };
    yield { type: 'done' };
  } catch (err) {
    if (options?.signal?.aborted) return;
    const message = err instanceof Error ? err.message : String(err);
    yield { type: 'error', message };
  }
}
