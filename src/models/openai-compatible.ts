import type { ChatMessage, ModelConfig, ModelEvent } from '../shared/types';
import { shouldIncludeStreamUsage } from './config';

interface OpenAIStreamChunk {
  choices?: Array<{
    delta?: { content?: string };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

export async function* streamChat(
  messages: ChatMessage[],
  config: ModelConfig,
  signal?: AbortSignal,
): AsyncGenerator<ModelEvent> {
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    stream: true,
  };

  // 阿里云百炼等部分 OpenAI 兼容接口不支持 stream_options
  if (shouldIncludeStreamUsage()) {
    body.stream_options = { include_usage: true };
  }

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
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
          yield { type: 'done' };
          return;
        }

        let parsed: OpenAIStreamChunk;
        try {
          parsed = JSON.parse(data) as OpenAIStreamChunk;
        } catch {
          continue;
        }

        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          yield { type: 'text_delta', delta };
        }

        if (parsed.usage) {
          yield {
            type: 'usage',
            promptTokens: parsed.usage.prompt_tokens ?? 0,
            completionTokens: parsed.usage.completion_tokens ?? 0,
          };
        }
      }
    }

    yield { type: 'done' };
  } catch (err) {
    if (signal?.aborted) return;
    const message = err instanceof Error ? err.message : String(err);
    yield { type: 'error', message };
  }
}
