import type { LlmMessage } from '../agent/types';
import type { ModelConfig } from '../shared/types';
import { getModelProtocol, loadModelConfig } from './config';
import { completeChatAnthropic } from './anthropic-like';
import { recordTokenUsage } from '../db/token-usage';
import { parseCompatibleUsage, type ParsedUsage } from './usage-parse';

export interface CompleteChatOptions {
  signal?: AbortSignal;
  sessionId?: string;
}
interface OpenAICompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: Record<string, unknown>;
}

function recordUsageFromResponse(
  config: ModelConfig,
  usage: ParsedUsage,
  sessionId?: string,
): void {
  if (usage.promptTokens === 0 && usage.completionTokens === 0) return;
  recordTokenUsage({
    sessionId,
    model: config.model,
    ...usage,
  });
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
  recordUsageFromResponse(config, parseCompatibleUsage(data.usage), options?.sessionId);

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
