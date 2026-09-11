import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  loopInput: null as null | { messages: Array<{ role: string; content: string }> },
  insertMessage: vi.fn(),
  scheduleCompress: vi.fn(),
  scheduleMemory: vi.fn(),
}));

vi.mock('../loop', () => ({
  runAgentLoop: async function* (input: { runId: string; messages: Array<{ role: string; content: string }> }) {
    state.loopInput = input;
    yield { type: 'text_delta', runId: input.runId, delta: '模型回答' };
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
  })),
}));
vi.mock('../../tools/agent-registry', () => ({
  getAgentRegistry: vi.fn(async () => ({
    list: () => [],
    toOpenAITools: () => [],
  })),
}));
vi.mock('../../skills/state', () => ({ getActiveSkills: vi.fn(() => []) }));
vi.mock('../policy-loader', () => ({ buildPermissionPolicy: vi.fn(() => ({})) }));
vi.mock('../../models/config', () => ({
  loadModelConfig: vi.fn(() => ({ model: 'test-model' })),
}));
vi.mock('../../db/repositories/sessions', () => ({
  getSession: vi.fn((id: string) => ({ id })),
}));
vi.mock('../../session/active', () => ({
  getActiveSession: vi.fn(() => ({ id: 'active-session' })),
}));
vi.mock('../../db/repositories/messages', () => ({
  insertMessage: (...args: unknown[]) => state.insertMessage(...args),
}));
vi.mock('../../memory/summarizer', () => ({
  extractMemoriesFromSession: vi.fn(async () => 0),
  shouldAutoExtractMemories: vi.fn(() => true),
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

describe('orchestrator runtime boundaries', () => {
  beforeEach(() => {
    state.loopInput = null;
    state.insertMessage.mockReset();
    state.scheduleCompress.mockReset();
    state.scheduleMemory.mockReset();
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
    expect(state.insertMessage).not.toHaveBeenCalled();
    expect(state.scheduleCompress).not.toHaveBeenCalled();
    expect(state.scheduleMemory).not.toHaveBeenCalled();
    expect(emitted.at(-1)).toMatchObject({ type: 'run_finished' });
  });
});
