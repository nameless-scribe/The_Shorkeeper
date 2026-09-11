import { afterEach, describe, expect, it, vi } from 'vitest';

const completeChat = vi.hoisted(() => vi.fn());

vi.mock('../../models/embedding-config', () => ({
  getEmbeddingModelName: vi.fn(() => 'embedding-test'),
  loadEmbeddingConfig: vi.fn(() => ({
    apiKey: 'test-key',
    baseUrl: 'https://example.test/v1',
    model: 'embedding-test',
  })),
}));
vi.mock('../../models/complete-chat', () => ({
  completeChat: (...args: unknown[]) => completeChat(...args),
}));

import { DEFAULT_EMBEDDING_TIMEOUT_MS, embedText } from '../embedding';
import { DEFAULT_HYDE_TIMEOUT_MS, generateHydeQuery } from '../hyde';

describe('RAG request timeouts', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    completeChat.mockReset();
  });

  it('bounds a non-responsive embedding request', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));

    const pending = embedText('测试查询');
    const assertion = expect(pending).rejects.toThrow('Embedding 请求超时');
    await vi.advanceTimersByTimeAsync(DEFAULT_EMBEDDING_TIMEOUT_MS);
    await assertion;
  });

  it('bounds a non-responsive HyDE request', async () => {
    vi.useFakeTimers();
    completeChat.mockReturnValue(new Promise(() => undefined));

    const pending = generateHydeQuery('测试查询');
    const assertion = expect(pending).rejects.toThrow('HyDE 请求超时');
    await vi.advanceTimersByTimeAsync(DEFAULT_HYDE_TIMEOUT_MS);
    await assertion;
  });
});
