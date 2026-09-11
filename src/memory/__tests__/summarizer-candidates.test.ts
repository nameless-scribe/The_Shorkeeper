import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  reply: '[]',
  upsertMemory: vi.fn(async () => undefined),
  createMemoryCandidate: vi.fn(() => undefined),
  markExtractedUpToMessageId: vi.fn(),
}));

vi.mock('../../db/repositories/messages', () => ({
  listMessages: vi.fn(() => [
    { id: 'user-1', role: 'user', content: '我喜欢拿铁' },
    { id: 'assistant-1', role: 'assistant', content: '记住了' },
  ]),
}));
vi.mock('../../models/complete-chat', () => ({
  completeChat: vi.fn(async () => state.reply),
}));
vi.mock('../../models/config', () => ({
  getModelConfigSafe: vi.fn(() => ({ apiKey: 'test', baseUrl: 'http://test', model: 'test' })),
}));
vi.mock('../../config/performance', () => ({
  getPerformanceSettings: vi.fn(() => ({
    contextMaxInputTokens: 24_000,
    memoryExtractMode: 'always',
    memoryExtractInterval: 3,
  })),
}));
vi.mock('../../db/app-settings', () => ({
  getSetting: vi.fn(() => null),
  setSetting: vi.fn(),
}));
vi.mock('../extraction-state', () => ({
  getExtractedUpToMessageId: vi.fn(() => null),
  markExtractedUpToMessageId: state.markExtractedUpToMessageId,
}));
vi.mock('../long-term', () => ({
  formatMemoriesForExtraction: vi.fn(() => '（暂无）'),
  listMemories: vi.fn(() => []),
  upsertMemory: state.upsertMemory,
}));
vi.mock('../../db/repositories/memory-candidates', () => ({
  createMemoryCandidate: state.createMemoryCandidate,
}));

import { completeChat } from '../../models/complete-chat';
import { extractMemoriesFromSession, shouldAutoExtractMemories } from '../summarizer';

describe('summarizer candidate boundary', () => {
  beforeEach(() => {
    state.reply = '[]';
    state.upsertMemory.mockClear();
    state.createMemoryCandidate.mockClear();
    state.markExtractedUpToMessageId.mockClear();
    vi.mocked(completeChat).mockClear();
  });

  it('silently upserts only a high-confidence stable fact', async () => {
    state.reply = JSON.stringify([
      {
        key: 'user.preference.drink',
        content: '用户喜欢拿铁',
        confidence: 0.95,
        reason: '用户明确表达',
      },
      {
        key: 'user.relationship.trust',
        content: '用户重视稳定陪伴',
        confidence: 0.95,
        reason: '关系类事实需确认',
      },
    ]);

    await expect(extractMemoriesFromSession('session-1')).resolves.toBe(1);
    expect(state.upsertMemory).toHaveBeenCalledOnce();
    expect(state.upsertMemory).toHaveBeenCalledWith(
      'user.preference.drink',
      '用户喜欢拿铁',
      0.95,
      'session-1',
      { skipEmbedding: true },
    );
    expect(state.createMemoryCandidate).toHaveBeenCalledOnce();
    expect(state.createMemoryCandidate).toHaveBeenCalledWith(expect.objectContaining({
      memoryKey: 'user.relationship.trust',
      category: 'relationship',
      sourceSessionId: 'session-1',
    }));
  });

  it('keeps legacy output conservative by creating a candidate', async () => {
    state.reply = JSON.stringify([{ key: 'user.preference.drink', content: '用户喜欢拿铁' }]);

    await expect(extractMemoriesFromSession('session-1')).resolves.toBe(0);
    expect(state.upsertMemory).not.toHaveBeenCalled();
    expect(state.createMemoryCandidate).toHaveBeenCalledOnce();
  });

  it('skips companion auto-extraction without calling the model', async () => {
    expect(shouldAutoExtractMemories('session-1', '我喜欢拿铁', 'companion')).toBe(false);
    expect(shouldAutoExtractMemories('session-1', '我喜欢拿铁', 'focus')).toBe(true);

    await expect(extractMemoriesFromSession('session-1', undefined, {
      assistantMode: 'companion',
    })).resolves.toBe(0);

    expect(completeChat).not.toHaveBeenCalled();
    expect(state.upsertMemory).not.toHaveBeenCalled();
    expect(state.createMemoryCandidate).not.toHaveBeenCalled();
    expect(state.markExtractedUpToMessageId).not.toHaveBeenCalled();
  });
});
