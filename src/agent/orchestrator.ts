import { createRunId, ev } from './events';
import { runAgentLoop } from './loop';
import type { AgUiEvent } from './types';
import { buildSystemPrompt } from './context-builder';
import { getBuiltinRegistry } from '../tools/builtin';
import { loadModelConfig } from '../models/config';
import { getOrCreateDefaultSession, getSession } from '../db/repositories/sessions';
import {
  insertMessage,
  listMessages,
  toChatMessages,
} from '../db/repositories/messages';
import { extractMemoriesFromSession } from '../memory/summarizer';

export async function* runOrchestrator(
  userMessage: string,
  sessionId?: string,
  signal?: AbortSignal,
): AsyncGenerator<AgUiEvent> {
  const runId = createRunId();
  const session = sessionId
    ? getSession(sessionId)
    : getOrCreateDefaultSession();

  if (!session) {
    yield ev.runError(runId, '会话不存在');
    return;
  }

  yield ev.runStarted(runId, session.id);

  try {
    loadModelConfig();
    insertMessage(session.id, 'user', userMessage);

    const history = toChatMessages(listMessages(session.id));
    const systemPrompt = buildSystemPrompt({
      userMessage,
      sessionId: session.id,
    });
    const messages = [
      { role: 'system' as const, content: systemPrompt },
      ...history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    ];

    let assistantText = '';

    for await (const event of runAgentLoop({
      sessionId: session.id,
      runId,
      messages,
      registry: getBuiltinRegistry(),
      signal,
    })) {
      if (event.type === 'text_delta') {
        assistantText += event.delta;
      }

      if (event.type === 'run_error') {
        yield event;
        return;
      }

      yield event;
    }

    if (!assistantText.trim()) {
      yield ev.runError(runId, '未能生成回复，请重试');
      return;
    }

    insertMessage(session.id, 'assistant', assistantText);

    yield ev.runFinished(runId);

    void extractMemoriesFromSession(session.id).catch((err) => {
      console.error('[memory] 提取失败:', err);
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield ev.runError(runId, message);
  }
}
