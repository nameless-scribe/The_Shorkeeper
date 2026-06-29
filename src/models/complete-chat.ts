import type { LlmMessage } from '../agent/types';
import type { ModelConfig } from '../shared/types';
import { getModelProtocol, loadModelConfig } from './config';
import { completeChatAnthropic } from './anthropic-like';
import { recordTokenUsage } from '../db/token-usage';

export interface CompleteChatOptions {
  signal?: AbortSignal;
  sessionId?: string;
}
interface OpenAICompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cached_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

function recordUsageFromResponse(
  config: ModelConfig,
  usage: {
    promptTokens: number;
    completionTokens: number;
    cachedTokens?: number;
  },
  sessionId?: string,
): void {
  if (usage.promptTokens === 0 && usage.completionTokens === 0) return;
  recordTokenUsage({
    sessionId,
    model: config.model,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    cachedTokens: usage.cachedTokens,
  });
}

function parseOpenAIUsage(data: OpenAICompletionResponse): {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
} {
  const usage = data.usage;
  return {
    promptTokens: usage?.prompt_tokens ?? 0,
    completionTokens: usage?.completion_tokens ?? 0,
    cachedTokens:
      usage?.prompt_tokens_details?.cached_tokens ?? usage?.cached_tokens ?? 0,
  };
}

async function completeChatOpenAI(
  messages: LlmMessage[],
  config: ModelConfig,
  options?: CompleteChatOptions,
): Promise<string> {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: false,
    }),
    signal: options?.signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API ${response.status}: ${text}`);
  }

  const data = (await response.json()) as OpenAICompletionResponse;
  recordUsageFromResponse(config, parseOpenAIUsage(data), options?.sessionId);

  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

export async function completeChat(
  messages: LlmMessage[],
  config?: ModelConfig,
  options?: CompleteChatOptions,
): Promise<string> {
  const resolved = config ?? loadModelConfig();

  if (getModelProtocol() === 'anthropic') {
    return completeChatAnthropic(messages, resolved, options);
  }

  return completeChatOpenAI(messages, resolved, options);
}
