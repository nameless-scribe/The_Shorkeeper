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
import { createRunRecorder } from './run-record';
import { acknowledgeInterruptedRuns } from './run-recovery';
import { resolveCallContract, resolveToolContract } from '../tools/contract';
import type { TaskRunKind } from '../shared/types';
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

export interface RunOrchestratorOptions {
  persistMessages?: boolean;
  /** 运行来源：普通聊天、定时任务或语音通话；写入 task_runs.kind */
  kind?: TaskRunKind;
  /** 触发来源引用（如定时任务 id） */
  triggerRef?: string | null;
}

export async function* runOrchestrator(
  userMessage: string,
  sessionId?: string,
  signal?: AbortSignal,
  options?: RunOrchestratorOptions,
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
  const recorder = createRunRecorder({
    runId,
    sessionId: session?.id ?? sessionId ?? 'unknown',
    kind: options?.kind ?? 'chat',
    triggerRef: options?.triggerRef ?? null,
  });
  let assistantMessageId: string | null = null;
  const transition = (
    phase: Parameters<typeof lifecycle.transition>[0],
    reason?: Parameters<typeof lifecycle.transition>[1],
  ) => {
    const snapshot = lifecycle.transition(phase, reason);
    telemetry.recordPhase(snapshot.phase);
    recorder.phase(snapshot.phase);
    return snapshot;
  };
  const finishRun = (
    phase: Extract<Parameters<typeof lifecycle.transition>[0], 'finished' | 'cancelled' | 'error'>,
    reason: Parameters<typeof lifecycle.transition>[1],
    errorMessage?: string,
  ) => {
    if (!lifecycle.isTerminal()) transition(phase, reason);
    telemetry.finish(phase, reason, errorMessage);
    recorder.finish(phase, reason ?? phase, errorMessage, assistantMessageId);
  };
  const persistMessage = (role: 'user' | 'assistant', content: string): void => {
    const activityId = telemetry.recordPersistenceStart(`${role}_message`);
    try {
      const message = insertMessage(session?.id ?? sessionId ?? 'unknown', role, content);
      if (role === 'assistant') assistantMessageId = message?.id ?? null;
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
  recorder.start();
  transition('running');

  try {
    const modelRuntime = loadModelRuntimeConfig();
    telemetry.setModel(modelRuntime.model);
    recorder.setModel(modelRuntime.model);
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
      let quickStep = 0;
      let quickCallId = '';
      const reply = await executeScheduleReminderIntent(scheduleIntent, signal, {
        runId,
        sessionId: session.id,
        onToolStart: (toolName, tool) => {
          quickCallId = `quick-${++quickStep}`;
          transition('waiting_tool');
          telemetry.recordToolStart(quickCallId, toolName);
          recorder.stepStart(quickCallId, toolName, resolveToolContract(tool));
        },
        onToolResult: (toolName, result) => {
          telemetry.recordToolEnd(quickCallId, result.success, result.error, result.errorCategory);
          recorder.stepEnd(quickCallId, toolName, result);
          transition('running');
        },
      });
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
      runKind: options?.kind ?? 'chat',
    });
    recorder.context(systemParts.contextSources);
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
    const toolNamesByCallId = new Map<string, string>();

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
      onPermissionStart: (toolName) => {
        recorder.waitingApproval();
        return telemetry.recordPermissionStart(toolName);
      },
      onPermissionEnd: (activityId, status, errorMessage) => {
        recorder.phase('waiting_tool');
        telemetry.recordPermissionEnd(activityId, status, errorMessage);
      },
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
        const tool = registry.get(event.name);
        recorder.stepStart(event.callId, event.name, tool ? resolveCallContract(tool, event.args) : undefined);
      } else if (event.type === 'tool_call_end') {
        telemetry.recordToolEnd(
          event.callId,
          event.result.success,
          event.result.error,
          event.result.errorCategory,
        );
        recorder.stepEnd(event.callId, toolNamesByCallId.get(event.callId) ?? 'unknown', event.result);
      } else if (event.type === 'usage') {
        telemetry.recordUsage(event.promptTokens, event.completionTokens, event.cachedTokens);
        try {
          recordTokenUsage({
            sessionId: session.id,
            model: modelRuntime.model,
            promptTokens: event.promptTokens,
            completionTokens: event.completionTokens,
            cachedTokens: event.cachedTokens,
          });
        } catch (error) {
          // 用量统计失败不应把一次成功的对话标成错误。
          console.warn('[agent] token 用量写入失败:', error instanceof Error ? error.message : error);
        }
      }
      if (event.type === 'tool_call_start') {
        toolNamesByCallId.set(event.callId, event.name);
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
    if (systemParts.interruptedRunId) {
      // 中断说明已经随本轮成功回复送达用户，之后不再注入（连同更早的中断记录）。
      acknowledgeInterruptedRuns(session.id);
    }
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
