import type { LlmMessage } from '../agent/types';
import type { ModelConfig, ModelProtocol } from '../shared/types';
import {
  getModelProtocol,
  loadModelRuntimeConfig,
  type ModelRuntimeConfig,
} from './config';
import { completeChatAnthropic } from './anthropic-like';
import { recordTokenUsage } from '../db/token-usage';
import { parseCompatibleUsage, type ParsedUsage } from './usage-parse';
import { createModelHttpError, fetchModelResponse } from './http';

export interface CompleteChatOptions {
  signal?: AbortSignal;
  sessionId?: string;
  protocol?: ModelProtocol;
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
  const response = await fetchModelResponse(`${config.baseUrl}/chat/completions`, {
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
    throw await createModelHttpError(response);
  }

  const data = (await response.json()) as OpenAICompletionResponse;
  recordUsageFromResponse(config, parseCompatibleUsage(data.usage), options?.sessionId);

  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

export async function completeChat(
  messages: LlmMessage[],
  config?: ModelConfig | ModelRuntimeConfig,
  options?: CompleteChatOptions,
): Promise<string> {
  const runtime = config ?? loadModelRuntimeConfig();
  const protocol = options?.protocol ??
    ('protocol' in runtime ? runtime.protocol : getModelProtocol());
  const resolved: ModelConfig = runtime;

  if (protocol === 'anthropic') {
    return completeChatAnthropic(messages, resolved, options);
  }

  return completeChatOpenAI(messages, resolved, options);
}
