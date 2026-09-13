import type { LlmMessage } from '../agent/types';
import type { ModelConfig, ModelEvent, ModelProtocol } from '../shared/types';
import type { OpenAIToolSchema } from '../tools/types';
import { getModelProtocol } from './config';
import { streamChatAnthropic } from './anthropic-like';
import { streamChat as streamChatOpenAI } from './openai-compatible';

export async function* streamChat(
  messages: LlmMessage[],
  config: ModelConfig,
  options?: {
    tools?: OpenAIToolSchema[];
    signal?: AbortSignal;
    cacheStablePrefix?: string;
    protocol?: ModelProtocol;
  },
): AsyncGenerator<ModelEvent> {
  const protocol = options?.protocol ?? getModelProtocol();
  if (protocol === 'anthropic') {
    yield* streamChatAnthropic(messages, config, options);
    return;
  }
  yield* streamChatOpenAI(messages, config, options);
}
