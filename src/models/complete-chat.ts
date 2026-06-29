import type { LlmMessage } from '../agent/types';
import type { ModelConfig } from '../shared/types';
import { loadModelConfig } from '../models/config';

export async function completeChat(
  messages: LlmMessage[],
  config?: ModelConfig,
  options?: { signal?: AbortSignal },
): Promise<string> {
  const resolved = config ?? loadModelConfig();

  const response = await fetch(`${resolved.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${resolved.apiKey}`,
    },
    body: JSON.stringify({
      model: resolved.model,
      messages,
      stream: false,
    }),
    signal: options?.signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API ${response.status}: ${text}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };

  return data.choices?.[0]?.message?.content?.trim() ?? '';
}
