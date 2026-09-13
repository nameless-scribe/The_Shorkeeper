import { createRunId, ev } from './events';
import { runAgentLoop } from './loop';
import type { AgUiEvent } from './types';
import { buildSystemPromptParts } from './context-builder';
import { resolveAgentRegistry } from '../tools/agent-registry';
import { getActiveSkillResolution } from '../skills/state';
import { buildPermissionPolicy } from './policy-loader';
import { loadModelRuntimeConfig } from '../models/config';
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
  compressSessionIfNeeded,
  getRecentChatMessages,
} from '../memory/session-context';
import {
  awaitPendingSessionWork,
  scheduleMemoryExtract,
  scheduleSessionCompress,
} from './session-background';
import { shouldPersistAssistantMessage } from './run-state';
import { parseScheduleReminderIntent } from '../scheduler/reminder-intent';
import { executeScheduleReminderIntent } from '../scheduler/reminder-handler';
import { createRunLifecycle } from './run-lifecycle';
import { createRunTelemetry } from './run-observability';
import {
  DEFAULT_CONTEXT_MAX_INPUT_TOKENS,
  estimateTokens,
  trimMessagesToTokenBudget,
} from './context-budget';
import { recordTokenUsage } from '../db/token-usage';

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
  const lifecycle = createRunLifecycle(runId, session?.id ?? sessionId ?? 'unknown');
  const telemetry = createRunTelemetry({
    runId,
    sessionId: session?.id ?? sessionId ?? 'unknown',
  });
  const transition = (
    phase: Parameters<typeof lifecycle.transition>[0],
    reason?: Parameters<typeof lifecycle.transition>[1],
  ) => {
    const snapshot = lifecycle.transition(phase, reason);
    telemetry.recordPhase(snapshot.phase);
    return snapshot;
  };
  const finishRun = (
    phase: Extract<Parameters<typeof lifecycle.transition>[0], 'finished' | 'cancelled' | 'error'>,
    reason: Parameters<typeof lifecycle.transition>[1],
    errorMessage?: string,
  ) => {
    if (!lifecycle.isTerminal()) transition(phase, reason);
    telemetry.finish(phase, reason, errorMessage);
  };
  const persistMessage = (role: 'user' | 'assistant', content: string): void => {
    const activityId = telemetry.recordPersistenceStart(`${role}_message`);
    try {
      insertMessage(session?.id ?? sessionId ?? 'unknown', role, content);
      telemetry.recordPersistenceEnd(activityId, 'succeeded');
    } catch (error) {
      telemetry.recordPersistenceEnd(
        activityId,
        'failed',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  };

  if (!session) {
    finishRun('error', 'session_not_found', '会话不存在');
    yield ev.runError(runId, '会话不存在', sessionId);
    return;
  }

  yield ev.runStarted(runId, session.id);
  transition('running');

  try {
    const modelRuntime = loadModelRuntimeConfig();
    telemetry.setModel(modelRuntime.model);
    await awaitPendingSessionWork(session.id, 5000, signal);
    if (signal?.aborted) {
      finishRun('cancelled', 'cancelled', '已取消');
      yield ev.runError(runId, '已取消', session.id);
      return;
    }
    if (persistMessages) {
      persistMessage('user', userMessage);
    }

    const archiveIntent = parseKnowledgeArchiveIntent(userMessage);
    if (archiveIntent.triggered) {
      const result = await archiveConversationToKnowledge(
        session.id,
        archiveIntent.scope,
        signal,
      );
      const reply = buildArchiveConfirmation(result);
      if (signal?.aborted) {
        finishRun('cancelled', 'cancelled', '已取消');
        yield ev.runError(runId, '已取消', session.id);
        return;
      }
      transition('finalizing');
      if (persistMessages) {
        persistMessage('assistant', reply);
      }
      finishRun('finished', 'finished');
      yield* streamText(runId, reply);
      yield ev.runFinished(runId);
      return;
    }

    const scheduleIntent = parseScheduleReminderIntent(userMessage);
    if (scheduleIntent.triggered) {
      const reply = await executeScheduleReminderIntent(scheduleIntent, signal);
      if (signal?.aborted) {
        finishRun('cancelled', 'cancelled', '已取消');
        yield ev.runError(runId, '已取消', session.id);
        return;
      }
      transition('finalizing');
      if (persistMessages) {
        persistMessage('assistant', reply);
      }
      finishRun('finished', 'finished');
      yield* streamText(runId, reply);
      yield ev.runFinished(runId);
      return;
    }

    const performanceSettings = getPerformanceSettings();
    const rawHistory = getRecentChatMessages(
      session.id,
      performanceSettings.maxHistoryMessages,
    );
    if (!persistMessages) {
      rawHistory.push({ role: 'user', content: userMessage });
    }
    const skillResolution = getActiveSkillResolution(userMessage);
    const registryResolution = await resolveAgentRegistry(skillResolution.activeSkills);
    const activeSkills = registryResolution.activeSkills;
    telemetry.setActiveSkills(activeSkills.map((skill) => skill.id));
    telemetry.setSkillDiagnostics(skillResolution.decisions, registryResolution.skillWarnings);
    const registry = registryResolution.registry;
    const maxInputTokens = performanceSettings.contextMaxInputTokens ??
      DEFAULT_CONTEXT_MAX_INPUT_TOKENS;
    const toolTokens = estimateTokens(JSON.stringify(registry.toOpenAITools()));
    const textBudget = Math.max(512, maxInputTokens - toolTokens);
    const systemBudget = Math.max(
      512,
      Math.min(8000, Math.floor(textBudget * 0.4)),
    );
    const systemParts = await buildSystemPromptParts({
      userMessage,
      sessionId: session.id,
      assistantMode: session.assistantMode,
      availableTools: registry.list(),
      activeSkills,
      skillWarnings: registryResolution.skillWarnings,
      signal,
      maxTokens: systemBudget,
    });
    const historyBudget = Math.max(1, textBudget - systemParts.budget.estimatedTokens);
    const budgetedHistory = trimMessagesToTokenBudget(rawHistory, historyBudget);
    const estimatedInputTokens = systemParts.budget.estimatedTokens +
      budgetedHistory.estimatedTokens + toolTokens;
    telemetry.recordContextBudget({
      maxInputTokens,
      estimatedInputTokens,
      systemTokens: systemParts.budget.estimatedTokens,
      historyTokens: budgetedHistory.estimatedTokens,
      toolTokens,
      trimmedHistoryMessages: budgetedHistory.trimmedCount,
      droppedSectionIds: systemParts.budget.droppedSectionIds,
      truncatedSectionIds: systemParts.budget.truncatedSectionIds,
      overBudgetTokens: Math.max(0, estimatedInputTokens - maxInputTokens),
    });
    const messages = [
      { role: 'system' as const, content: systemParts.combined },
      ...budgetedHistory.messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    ];
    const policy = buildPermissionPolicy();

    let assistantText = '';

    for await (const event of runAgentLoop({
      sessionId: session.id,
      runId,
      messages,
      registry,
      modelRuntime,
      policy,
      signal,
      cacheStablePrefix: systemParts.stable,
      onPhaseChange: (phase) => transition(phase),
      onModelRoundStart: (round) => telemetry.recordModelRoundStart(round),
      onModelRoundEnd: (round, status, errorMessage) =>
        telemetry.recordModelRoundEnd(round, status, errorMessage),
      onPermissionStart: (toolName) => telemetry.recordPermissionStart(toolName),
      onPermissionEnd: (activityId, status, errorMessage) =>
        telemetry.recordPermissionEnd(activityId, status, errorMessage),
    })) {
      if (event.type === 'text_delta') {
        assistantText += event.delta;
      }

      if (event.type === 'run_error') {
        finishRun(
          signal?.aborted ? 'cancelled' : 'error',
          signal?.aborted ? 'cancelled' : 'error',
          event.message,
        );
        yield { ...event, sessionId: event.sessionId ?? session.id };
        return;
      }

      if (event.type === 'tool_call_start') {
        telemetry.recordToolStart(event.callId, event.name);
      } else if (event.type === 'tool_call_end') {
        telemetry.recordToolEnd(
          event.callId,
          event.result.success,
          event.result.error,
          event.result.errorCategory,
        );
      } else if (event.type === 'usage') {
        telemetry.recordUsage(event.promptTokens, event.completionTokens, event.cachedTokens);
        recordTokenUsage({
          sessionId: session.id,
          model: modelRuntime.model,
          promptTokens: event.promptTokens,
          completionTokens: event.completionTokens,
          cachedTokens: event.cachedTokens,
        });
      }

      yield event;
    }

    if (signal?.aborted) {
      finishRun('cancelled', 'cancelled', '已取消');
      yield ev.runError(runId, '已取消', session.id);
      return;
    }

    transition('finalizing');
    if (
      !shouldPersistAssistantMessage({
        runId,
        sessionId: session.id,
        assistantText,
        signal,
        reason: 'finished',
      })
    ) {
      finishRun(
        signal?.aborted ? 'cancelled' : 'error',
        signal?.aborted ? 'cancelled' : 'empty_response',
        signal?.aborted ? '已取消' : '未能生成回复，请重试',
      );
      yield ev.runError(runId, '未能生成回复，请重试', session.id);
      return;
    }

    if (persistMessages) {
      persistMessage('assistant', assistantText);
    }

    finishRun('finished', 'finished');
    yield ev.runFinished(runId);

    if (persistMessages) {
      scheduleSessionCompress(session.id, (backgroundSignal) =>
        compressSessionIfNeeded(session.id, backgroundSignal),
        runId,
      );

      if (shouldAutoExtractMemories(session.id, userMessage, session.assistantMode)) {
        scheduleMemoryExtract(session.id, (backgroundSignal) =>
          extractMemoriesFromSession(session.id, backgroundSignal, {
            assistantMode: session.assistantMode,
          }),
          runId,
        );
      }
    }
  } catch (err) {
    const message = signal?.aborted
      ? '已取消'
      : err instanceof Error
        ? err.message
        : String(err);
    if (!lifecycle.isTerminal()) {
      finishRun(
        signal?.aborted ? 'cancelled' : 'error',
        signal?.aborted ? 'cancelled' : 'error',
        message,
      );
    }
    yield ev.runError(runId, message, session?.id ?? sessionId);
  } finally {
    if (!lifecycle.isTerminal()) {
      finishRun(
        signal?.aborted ? 'cancelled' : 'error',
        signal?.aborted ? 'cancelled' : 'consumer_closed',
        signal?.aborted ? '已取消' : '消费者关闭',
      );
    }
  }
}
