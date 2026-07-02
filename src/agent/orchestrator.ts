import { createRunId, ev } from './events';
import { runAgentLoop } from './loop';
import type { AgUiEvent } from './types';
import { buildSystemPromptParts } from './context-builder';
import { getAgentRegistry } from '../tools/agent-registry';
import { buildPermissionPolicy } from './policy-loader';
import { loadModelConfig } from '../models/config';
import { getSession } from '../db/repositories/sessions';
import { getActiveSession } from '../session/active';
import {
  insertMessage,
} from '../db/repositories/messages';
import { extractMemoriesFromSession, shouldAutoExtractMemories } from '../memory/summarizer';
import {
  archiveConversationToKnowledge,
  buildArchiveConfirmation,
  parseKnowledgeArchiveIntent,
} from '../rag/conversation-knowledge';
import { getPerformanceSettings } from '../config/performance';
import {
  getRecentChatMessages,
  maybeCompressSession,
} from '../memory/session-context';
import {
  awaitPendingSessionWork,
  scheduleMemoryExtract,
  scheduleSessionCompress,
} from './session-background';
import { shouldPersistAssistantMessage } from './run-state';
import { parseScheduleReminderIntent } from '../scheduler/reminder-intent';
import { executeScheduleReminderIntent } from '../scheduler/reminder-handler';

async function* streamText(runId: string, text: string): AsyncGenerator<AgUiEvent> {
  const chunkSize = 12;
  for (let i = 0; i < text.length; i += chunkSize) {
    yield ev.textDelta(runId, text.slice(i, i + chunkSize));
  }
}

export async function* runOrchestrator(
  userMessage: string,
  sessionId?: string,
  signal?: AbortSignal,
  options?: { persistMessages?: boolean },
): AsyncGenerator<AgUiEvent> {
  const persistMessages = options?.persistMessages !== false;
  const runId = createRunId();
  const session = sessionId
    ? getSession(sessionId)
    : getActiveSession();

  if (!session) {
    yield ev.runError(runId, '会话不存在', sessionId);
    return;
  }

  yield ev.runStarted(runId, session.id);

  try {
    loadModelConfig();
    await awaitPendingSessionWork(session.id);
    if (persistMessages) {
      insertMessage(session.id, 'user', userMessage);
    }

    const archiveIntent = parseKnowledgeArchiveIntent(userMessage);
    if (archiveIntent.triggered) {
      const result = await archiveConversationToKnowledge(
        session.id,
        archiveIntent.scope,
        signal,
      );
      const reply = buildArchiveConfirmation(result);
      if (persistMessages) {
        insertMessage(session.id, 'assistant', reply);
      }
      yield* streamText(runId, reply);
      yield ev.runFinished(runId);
      return;
    }

    const scheduleIntent = parseScheduleReminderIntent(userMessage);
    if (scheduleIntent.triggered) {
      const reply = await executeScheduleReminderIntent(scheduleIntent);
      if (persistMessages) {
        insertMessage(session.id, 'assistant', reply);
      }
      yield* streamText(runId, reply);
      yield ev.runFinished(runId);
      return;
    }

    const { maxHistoryMessages } = getPerformanceSettings();
    const history = getRecentChatMessages(session.id, maxHistoryMessages);
    const registry = await getAgentRegistry();
    const systemParts = await buildSystemPromptParts({
      userMessage,
      sessionId: session.id,
      availableTools: registry.list(),
    });
    const messages = [
      { role: 'system' as const, content: systemParts.combined },
      ...history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    ];
    const policy = buildPermissionPolicy();

    let assistantText = '';

    for await (const event of runAgentLoop({
      sessionId: session.id,
      runId,
      messages,
      registry,
      policy,
      signal,
      cacheStablePrefix: systemParts.stable,
    })) {
      if (event.type === 'text_delta') {
        assistantText += event.delta;
      }

      if (event.type === 'run_error') {
        yield { ...event, sessionId: event.sessionId ?? session.id };
        return;
      }

      yield event;
    }

    if (signal?.aborted) {
      yield ev.runError(runId, '已取消', session.id);
      return;
    }

    if (
      !shouldPersistAssistantMessage({
        runId,
        sessionId: session.id,
        assistantText,
        signal,
        reason: 'finished',
      })
    ) {
      yield ev.runError(runId, '未能生成回复，请重试', session.id);
      return;
    }

    if (persistMessages) {
      insertMessage(session.id, 'assistant', assistantText);
    }

    yield ev.runFinished(runId);

    if (persistMessages) {
      void scheduleSessionCompress(session.id, () =>
        maybeCompressSession(session.id).catch((err) => {
          console.error('[session] 压缩失败:', err);
          return false;
        }),
      );

      if (shouldAutoExtractMemories(session.id, userMessage)) {
        scheduleMemoryExtract(session.id, () =>
          extractMemoriesFromSession(session.id).catch((err) => {
            console.error('[memory] 提取失败:', err);
            return 0;
          }),
        );
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield ev.runError(runId, message, session?.id ?? sessionId);
  }
}
