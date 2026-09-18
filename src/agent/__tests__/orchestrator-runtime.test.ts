import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  loopInput: null as null | {
    messages: Array<{ role: string; content: string }>;
    modelRuntime?: { model: string; protocol: string; profileId: string | null };
  },
  insertMessage: vi.fn(),
  scheduleCompress: vi.fn(),
  scheduleMemory: vi.fn(),
  recordTokenUsage: vi.fn(),
  createTaskRun: vi.fn(),
  finishTaskRun: vi.fn(),
  updateTaskRunPhase: vi.fn(),
  setTaskRunModel: vi.fn(),
  acknowledgeTaskRun: vi.fn(),
  databaseReady: true,
  readCheckpoint: vi.fn(),
  claimCheckpoint: vi.fn(),
  validateCheckpoint: vi.fn(),
  loopStopReason: undefined as undefined | 'budget_exhausted' | 'awaiting_input',
  assistantMode: 'focus' as 'focus' | 'organize' | 'review' | 'companion',
}));

vi.mock('../../db/repositories/run-checkpoints', () => ({
  readRunCheckpoint: (...args: unknown[]) => state.readCheckpoint(...args),
  claimRunCheckpoint: (...args: unknown[]) => state.claimCheckpoint(...args),
  saveRunCheckpoint: vi.fn(),
}));
vi.mock('../checkpoint-tracker', () => ({
  checkpointEnvironment: () => 'a'.repeat(64),
  validateCheckpointFiles: (...args: unknown[]) => state.validateCheckpoint(...args),
}));
vi.mock('../permissions', () => ({ ensureWorkspaceDir: () => 'isolated-test-workspace' }));

vi.mock('../../db/state', () => ({
  isDatabaseReady: () => state.databaseReady,
}));
vi.mock('../../db/repositories/task-runs', () => ({
  createTaskRun: (...args: unknown[]) => state.createTaskRun(...args),
  finishTaskRun: (...args: unknown[]) => state.finishTaskRun(...args),
  updateTaskRunPhase: (...args: unknown[]) => state.updateTaskRunPhase(...args),
  setTaskRunModel: (...args: unknown[]) => state.setTaskRunModel(...args),
  startTaskRunStep: vi.fn(),
  endTaskRunStep: vi.fn(),
  recordRunArtifacts: vi.fn(),
  findUnacknowledgedInterruptedRun: vi.fn(() => null),
  listTaskRunSteps: vi.fn(() => []),
  listRunArtifacts: vi.fn(() => []),
  acknowledgeTaskRun: vi.fn(),
  acknowledgeInterruptedRunsForSession: (...args: unknown[]) => state.acknowledgeTaskRun(...args),
  markInterruptedRuns: vi.fn(),
  createApproval: vi.fn(),
  decideApproval: vi.fn(),
}));

vi.mock('../loop', () => ({
  runAgentLoop: async function* (input: {
    runId: string;
    messages: Array<{ role: string; content: string }>;
    modelRuntime?: { model: string; protocol: string; profileId: string | null };
  }) {
    state.loopInput = input;
    yield {
      type: 'usage',
      runId: input.runId,
      promptTokens: 12,
      completionTokens: 3,
      cachedTokens: 2,
    };
    yield { type: 'text_delta', runId: input.runId, delta: '模型回答' };
    if (state.loopStopReason) yield { type: 'run_error', runId: input.runId, reason: state.loopStopReason, message: '本段已停止' };
  },
}));
vi.mock('../context-builder', () => ({
  buildSystemPromptParts: vi.fn(async () => ({
    stable: '稳定人设',
    dynamic: null,
    combined: '稳定人设',
    budget: {
      maxTokens: 1000,
      estimatedTokens: 10,
      includedSectionIds: ['stable_prefix'],
      droppedSectionIds: [],
      truncatedSectionIds: [],
    },
    contextSources: [],
  })),
}));
vi.mock('../../tools/agent-registry', () => ({
  resolveAgentRegistry: vi.fn(async () => ({
    activeSkills: [],
    skillWarnings: [],
    registry: {
      list: () => [],
      toOpenAITools: () => [],
    },
  })),
}));
vi.mock('../../skills/state', () => ({
  getActiveSkillResolution: vi.fn(() => ({ activeSkills: [], decisions: [] })),
}));
vi.mock('../policy-loader', () => ({ buildPermissionPolicy: vi.fn(() => ({})) }));
vi.mock('../../models/config', () => ({
  loadModelRuntimeConfig: vi.fn(() => ({
    apiKey: 'test-key',
    baseUrl: 'https://example.test',
    model: 'test-model',
    protocol: 'anthropic',
    profileId: 'profile-test',
  })),
}));
vi.mock('../../db/repositories/sessions', () => ({
  getSession: vi.fn((id: string) => ({ id, assistantMode: state.assistantMode })),
}));
vi.mock('../../session/active', () => ({
  getActiveSession: vi.fn(() => ({ id: 'active-session' })),
}));
vi.mock('../../db/repositories/messages', () => ({
  insertMessage: (...args: unknown[]) => state.insertMessage(...args),
}));
vi.mock('../../db/token-usage', () => ({
  recordTokenUsage: (...args: unknown[]) => state.recordTokenUsage(...args),
}));
vi.mock('../../memory/summarizer', () => ({
  extractMemoriesFromSession: vi.fn(async () => 0),
  shouldAutoExtractMemories: vi.fn((_sessionId: string, _message: string, mode?: string) => mode !== 'companion'),
}));
vi.mock('../../rag/conversation-knowledge', () => ({
  archiveConversationToKnowledge: vi.fn(),
  buildArchiveConfirmation: vi.fn(),
  parseKnowledgeArchiveIntent: vi.fn(() => ({ triggered: false })),
}));
vi.mock('../../config/performance', () => ({
  getPerformanceSettings: vi.fn(() => ({
    maxHistoryMessages: 20,
    contextMaxInputTokens: 24_000,
  })),
}));
vi.mock('../../memory/session-context', () => ({
  compressSessionIfNeeded: vi.fn(async () => ({ compressed: false, reason: 'below_threshold' })),
  getRecentChatMessages: vi.fn(() => [
    { role: 'assistant', content: '此前回答' },
  ]),
}));
vi.mock('../session-background', () => ({
  awaitPendingSessionWork: vi.fn(async () => undefined),
  scheduleSessionCompress: (...args: unknown[]) => state.scheduleCompress(...args),
  scheduleMemoryExtract: (...args: unknown[]) => state.scheduleMemory(...args),
}));
vi.mock('../../scheduler/reminder-intent', () => ({
  parseScheduleReminderIntent: vi.fn(() => ({ triggered: false })),
}));
vi.mock('../../scheduler/reminder-handler', () => ({
  executeScheduleReminderIntent: vi.fn(),
}));

import { runOrchestrator } from '../orchestrator';
import { buildSystemPromptParts } from '../context-builder';

describe('orchestrator runtime boundaries', () => {
  beforeEach(() => {
    state.loopInput = null;
    state.readCheckpoint.mockReset();
    state.claimCheckpoint.mockReset();
    state.validateCheckpoint.mockReset();
    state.loopStopReason = undefined;
    state.assistantMode = 'focus';
    state.insertMessage.mockReset();
    state.insertMessage.mockImplementation((_sessionId: string, role: string) => ({ id: `${role}-message-id` }));
    state.scheduleCompress.mockReset();
    state.scheduleMemory.mockReset();
    state.recordTokenUsage.mockReset();
    state.createTaskRun.mockReset();
    state.finishTaskRun.mockReset();
    state.updateTaskRunPhase.mockReset();
    state.setTaskRunModel.mockReset();
    state.acknowledgeTaskRun.mockReset();
    state.databaseReady = true;
  });

  it.each(['budget_exhausted', 'awaiting_input'] as const)('persists the partial summary without marking %s as finished', async (reason) => {
    state.loopStopReason = reason;
    const events = [];
    for await (const event of runOrchestrator('复杂任务', 'focus-session')) events.push(event);
    expect(state.insertMessage).toHaveBeenCalledWith('focus-session', 'assistant', '模型回答');
    expect(events.at(-1)).toMatchObject({ type: 'run_error', reason });
    expect(events.some((event) => event.type === 'run_finished')).toBe(false);
    expect(state.finishTaskRun).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      phase: 'error', terminalReason: reason, assistantMessageId: 'assistant-message-id',
    }));
    expect(state.scheduleMemory).not.toHaveBeenCalled();
  });

  it('validates and claims an explicit continuation before passing bounded pinned facts to the loop', async () => {
    state.readCheckpoint.mockReturnValue({ version: 1, goal: '导出已核对的结果', answers: ['金额含税'], facts: ['CSV 已完成'],
      pending: ['Excel 未完成'], files: [], completedEffects: [], environment: 'a'.repeat(64), rootRunId: 'parent',
      totals: { rounds: 20, toolCalls: 30, tokens: 100000, activeMs: 1000, segments: 1 } });
    const events = [];
    for await (const event of runOrchestrator('确认继续一段', 's', undefined, { resumeCheckpointId: 'cp' })) events.push(event);
    expect(state.readCheckpoint).toHaveBeenCalledWith('cp', 's');
    expect(state.validateCheckpoint).toHaveBeenCalledOnce();
    expect(state.claimCheckpoint).toHaveBeenCalledWith('cp', 's', expect.any(String));
    const messages = state.loopInput?.messages ?? [];
    expect(messages).toHaveLength(2);
    expect(messages[1].content).toContain('金额含税');
    expect(messages[1].content).toContain('CSV 已完成');
    expect(messages[1].content).not.toContain('此前回答');
    expect(events.at(-1)).toMatchObject({ type: 'run_finished' });
  });

  it('does not enter the tool loop or claim a checkpoint when source validation fails', async () => {
    state.readCheckpoint.mockReturnValue({ goal: '原任务' });
    state.validateCheckpoint.mockRejectedValueOnce(new Error('来源变化'));
    const events = [];
    for await (const event of runOrchestrator('确认继续一段', 's', undefined, { resumeCheckpointId: 'cp' })) events.push(event);
    expect(state.loopInput).toBeNull();
    expect(state.claimCheckpoint).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ type: 'run_error', message: '来源变化' });
  });

  it('acknowledges the interrupted-run notice only after this run finishes successfully', async () => {
    vi.mocked(buildSystemPromptParts).mockResolvedValueOnce({
      stable: '稳定人设',
      dynamic: '【上次运行中断】…',
      combined: '稳定人设\n\n【上次运行中断】…',
      budget: {
        maxTokens: 1000,
        estimatedTokens: 20,
        includedSectionIds: ['stable_prefix', 'interrupted_run'],
        droppedSectionIds: [],
        truncatedSectionIds: [],
      },
      interruptedRunId: 'left-over-run',
      contextSources: [],
    });

    const emitted = [];
    for await (const event of runOrchestrator('继续吧', 'focus-session')) {
      emitted.push(event);
    }

    expect(emitted.at(-1)).toMatchObject({ type: 'run_finished' });
    expect(state.acknowledgeTaskRun).toHaveBeenCalledWith('focus-session');
    expect(vi.mocked(buildSystemPromptParts).mock.calls.at(-1)?.[0]).toMatchObject({ runKind: 'chat' });
  });

  it('tells the context builder when a run is scheduled or voice so the notice stays for the user', async () => {
    for await (const _event of runOrchestrator('定时任务', 'focus-session', undefined, { kind: 'scheduled' })) {
      // drain
    }
    expect(vi.mocked(buildSystemPromptParts).mock.calls.at(-1)?.[0]).toMatchObject({ runKind: 'scheduled' });
    expect(state.acknowledgeTaskRun).not.toHaveBeenCalled();
  });

  it('does not acknowledge the interrupted-run notice when the run fails', async () => {
    vi.mocked(buildSystemPromptParts).mockResolvedValueOnce({
      stable: '稳定人设',
      dynamic: null,
      combined: '稳定人设',
      budget: {
        maxTokens: 1000,
        estimatedTokens: 10,
        includedSectionIds: ['stable_prefix', 'interrupted_run'],
        droppedSectionIds: [],
        truncatedSectionIds: [],
      },
      interruptedRunId: 'left-over-run',
      contextSources: [],
    });
    state.insertMessage.mockImplementation((_sessionId: string, role: string) => {
      if (role === 'assistant') throw new Error('写入失败');
      return { id: 'user-message-id' };
    });

    const emitted = [];
    for await (const event of runOrchestrator('继续吧', 'focus-session')) {
      emitted.push(event);
    }

    expect(emitted.at(-1)).toMatchObject({ type: 'run_error' });
    expect(state.acknowledgeTaskRun).not.toHaveBeenCalled();
  });

  it('persists the run record from start to terminal state with the assistant message id', async () => {
    const emitted = [];
    for await (const event of runOrchestrator('推进这个任务', 'focus-session', undefined, {
      kind: 'scheduled',
      triggerRef: 'task-1',
    })) {
      emitted.push(event);
    }

    expect(state.createTaskRun).toHaveBeenCalledOnce();
    expect(state.createTaskRun.mock.calls[0][0]).toMatchObject({
      sessionId: 'focus-session',
      kind: 'scheduled',
      triggerRef: 'task-1',
    });
    expect(state.setTaskRunModel).toHaveBeenCalledWith(expect.any(String), 'test-model');
    expect(state.finishTaskRun).toHaveBeenCalledOnce();
    expect(state.finishTaskRun.mock.calls[0][1]).toMatchObject({
      phase: 'finished',
      terminalReason: 'finished',
      assistantMessageId: 'assistant-message-id',
    });
    expect(emitted.at(-1)).toMatchObject({ type: 'run_finished' });
  });

  it('keeps the run working when run persistence is unavailable', async () => {
    state.createTaskRun.mockImplementation(() => {
      throw new Error('disk full');
    });
    const emitted = [];
    for await (const event of runOrchestrator('推进这个任务', 'focus-session')) {
      emitted.push(event);
    }
    expect(emitted.at(-1)).toMatchObject({ type: 'run_finished' });
    expect(state.finishTaskRun).not.toHaveBeenCalled();
  });

  it('records the token usage failure without failing the run', async () => {
    state.recordTokenUsage.mockImplementation(() => {
      throw new Error('database closed');
    });
    const emitted = [];
    for await (const event of runOrchestrator('推进这个任务', 'focus-session')) {
      emitted.push(event);
    }
    expect(emitted.at(-1)).toMatchObject({ type: 'run_finished' });
  });

  it('includes the current user turn without persisting voice transcripts', async () => {
    const emitted = [];
    for await (const event of runOrchestrator(
      '本轮语音问题',
      'voice-session',
      undefined,
      { persistMessages: false },
    )) {
      emitted.push(event);
    }

    expect(state.loopInput?.messages).toEqual([
      { role: 'system', content: '稳定人设' },
      { role: 'assistant', content: '此前回答' },
      { role: 'user', content: '本轮语音问题' },
    ]);
    expect(state.loopInput?.modelRuntime).toMatchObject({
      model: 'test-model',
      protocol: 'anthropic',
      profileId: 'profile-test',
    });
    expect(state.recordTokenUsage).toHaveBeenCalledWith({
      sessionId: 'voice-session',
      model: 'test-model',
      promptTokens: 12,
      completionTokens: 3,
      cachedTokens: 2,
    });
    expect(state.insertMessage).not.toHaveBeenCalled();
    expect(state.scheduleCompress).not.toHaveBeenCalled();
    expect(state.scheduleMemory).not.toHaveBeenCalled();
    expect(emitted.at(-1)).toMatchObject({ type: 'run_finished' });
  });

  it('schedules memory extraction after a persisted focus run', async () => {
    const emitted = [];
    for await (const event of runOrchestrator('推进这个任务', 'focus-session')) {
      emitted.push(event);
    }

    expect(state.insertMessage).toHaveBeenCalled();
    expect(state.scheduleCompress).toHaveBeenCalledOnce();
    expect(state.scheduleMemory).toHaveBeenCalledOnce();
    expect(emitted.at(-1)).toMatchObject({ type: 'run_finished' });
  });

  it('does not auto-extract memories for companion sessions', async () => {
    state.assistantMode = 'companion';
    const emitted = [];
    for await (const event of runOrchestrator('今天有点累', 'companion-session')) {
      emitted.push(event);
    }

    expect(state.insertMessage).toHaveBeenCalled();
    expect(state.scheduleCompress).toHaveBeenCalledOnce();
    expect(state.scheduleMemory).not.toHaveBeenCalled();
    expect(emitted.at(-1)).toMatchObject({ type: 'run_finished' });
  });
});
