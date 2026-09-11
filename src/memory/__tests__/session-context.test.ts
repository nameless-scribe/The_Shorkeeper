import { beforeEach, describe, expect, it, vi } from 'vitest';
import { estimateTokens } from '../../agent/context-budget';

const state = vi.hoisted(() => ({
  config: { model: 'test-model' } as { model: string } | null,
  messages: [] as Array<{ id: string; role: string; content: string }>,
  summary: null as { summary: string; compressedUpToMessageId: string | null } | null,
  completion: '压缩后的摘要',
  upsert: vi.fn(),
  complete: vi.fn(),
  compressThreshold: 4,
  maxHistoryMessages: 2,
}));

vi.mock('../../db/repositories/messages', () => ({
  listMessages: vi.fn(() => state.messages),
}));
vi.mock('../../db/repositories/session-summaries', () => ({
  getSessionSummary: vi.fn(() => state.summary),
  upsertSessionSummary: (...args: unknown[]) => state.upsert(...args),
}));
vi.mock('../../models/complete-chat', () => ({
  completeChat: (...args: unknown[]) => state.complete(...args),
}));
vi.mock('../../models/config', () => ({
  getModelConfigSafe: vi.fn(() => state.config),
}));
vi.mock('../../config/performance', () => ({
  getPerformanceSettings: vi.fn(() => ({
    compressThreshold: state.compressThreshold,
    maxHistoryMessages: state.maxHistoryMessages,
  })),
}));

import { compressSessionIfNeeded } from '../session-context';

function makeMessages(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `m-${index + 1}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `消息 ${index + 1}`,
  }));
}

describe('session context compression', () => {
  beforeEach(() => {
    state.config = { model: 'test-model' };
    state.messages = [];
    state.summary = null;
    state.completion = '压缩后的摘要';
    state.compressThreshold = 4;
    state.maxHistoryMessages = 2;
    state.upsert.mockReset();
    state.complete.mockReset().mockImplementation(async () => state.completion);
  });

  it('reports when no model is available', async () => {
    state.config = null;

    await expect(compressSessionIfNeeded('session-1')).resolves.toEqual({
      compressed: false,
      reason: 'model_unavailable',
      messageCount: 0,
      compressedMessageCount: 0,
    });
  });

  it('reports when the conversation is below the compression threshold', async () => {
    state.messages = makeMessages(4);

    await expect(compressSessionIfNeeded('session-1')).resolves.toMatchObject({
      compressed: false,
      reason: 'below_threshold',
      messageCount: 4,
    });
    expect(state.complete).not.toHaveBeenCalled();
  });

  it('does not summarize messages already covered by the checkpoint', async () => {
    state.messages = makeMessages(6);
    state.summary = { summary: '已有摘要', compressedUpToMessageId: 'm-4' };

    await expect(compressSessionIfNeeded('session-1')).resolves.toMatchObject({
      compressed: false,
      reason: 'already_compressed',
      compressedMessageCount: 0,
    });
    expect(state.complete).not.toHaveBeenCalled();
  });

  it('does not compress from the front when the keep count exceeds message count', async () => {
    state.messages = makeMessages(40);
    state.compressThreshold = 20;
    state.maxHistoryMessages = 60;

    await expect(compressSessionIfNeeded('session-1')).resolves.toMatchObject({
      compressed: false,
      reason: 'already_compressed',
      compressedMessageCount: 0,
    });
    expect(state.complete).not.toHaveBeenCalled();
  });

  it('does not repeat content when the checkpoint is beyond the current boundary', async () => {
    state.messages = makeMessages(8);
    state.compressThreshold = 4;
    state.maxHistoryMessages = 6;
    state.summary = { summary: '已有摘要', compressedUpToMessageId: 'm-4' };

    await expect(compressSessionIfNeeded('session-1')).resolves.toMatchObject({
      compressed: false,
      reason: 'already_compressed',
    });
    expect(state.complete).not.toHaveBeenCalled();
  });

  it('compresses oversized history in bounded batches', async () => {
    state.messages = makeMessages(8).map((message) => ({
      ...message,
      content: '长消息'.repeat(4000),
    }));
    state.maxHistoryMessages = 2;

    await compressSessionIfNeeded('session-1');

    const promptMessages = state.complete.mock.calls[0][0] as Array<{ content: string }>;
    expect(estimateTokens(promptMessages[1].content)).toBeLessThanOrEqual(16_000);
  });

  it('records an empty model summary without advancing the checkpoint', async () => {
    state.messages = makeMessages(6);
    state.completion = '   ';

    await expect(compressSessionIfNeeded('session-1')).resolves.toMatchObject({
      compressed: false,
      reason: 'empty_summary',
      compressedMessageCount: 4,
    });
    expect(state.upsert).not.toHaveBeenCalled();
  });

  it('persists the summary and reports the compressed message count', async () => {
    state.messages = makeMessages(6);
    const controller = new AbortController();

    await expect(compressSessionIfNeeded('session-1', controller.signal)).resolves.toEqual({
      compressed: true,
      reason: 'compressed',
      messageCount: 6,
      compressedMessageCount: 4,
    });
    expect(state.upsert).toHaveBeenCalledWith('session-1', '压缩后的摘要', 'm-4');
    expect(state.complete).toHaveBeenCalledWith(
      expect.any(Array),
      state.config,
      { sessionId: 'session-1', signal: controller.signal },
    );
  });
});
