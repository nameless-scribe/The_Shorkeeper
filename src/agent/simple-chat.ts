import { v4 as uuid } from 'uuid';
import type { AgUiEvent, ChatMessage } from '../shared/types';
import { loadModelConfig } from '../models/config';
import { streamChat } from '../models/openai-compatible';
import { getOrCreateDefaultSession, getSession } from '../db/repositories/sessions';
import {
  insertMessage,
  listMessages,
  toChatMessages,
} from '../db/repositories/messages';

const DEFAULT_SYSTEM_PROMPT = `你是守岸人，一位温柔、可靠的桌面 AI 伴侣。
请用自然、简洁的中文与用户交流，保持友好和耐心。`;

export async function* runSimpleChat(
  userMessage: string,
  sessionId?: string,
): AsyncGenerator<AgUiEvent> {
  const runId = uuid();
  const session = sessionId
    ? getSession(sessionId)
    : getOrCreateDefaultSession();

  if (!session) {
    yield { type: 'run_error', runId, message: '会话不存在' };
    return;
  }

  yield { type: 'run_started', runId, sessionId: session.id };

  try {
    const config = loadModelConfig();
    insertMessage(session.id, 'user', userMessage);

    const history = toChatMessages(listMessages(session.id));
    const messages: ChatMessage[] = [
      { role: 'system', content: DEFAULT_SYSTEM_PROMPT },
      ...history,
    ];

    let assistantText = '';

    for await (const event of streamChat(messages, config)) {
      if (event.type === 'text_delta') {
        assistantText += event.delta;
        yield { type: 'text_delta', runId, delta: event.delta };
      } else if (event.type === 'usage') {
        yield {
          type: 'usage',
          runId,
          promptTokens: event.promptTokens,
          completionTokens: event.completionTokens,
        };
      } else if (event.type === 'error') {
        yield { type: 'run_error', runId, message: event.message };
        return;
      }
    }

    if (assistantText.trim()) {
      insertMessage(session.id, 'assistant', assistantText);
    }

    yield { type: 'run_finished', runId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield { type: 'run_error', runId, message };
  }
}
