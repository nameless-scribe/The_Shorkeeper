import { afterEach, describe, expect, it, vi } from 'vitest';

const completeChat = vi.hoisted(() => vi.fn());
const loadEmbeddingConfig = vi.hoisted(() => vi.fn(() => ({
  apiKey: 'test-key',
  baseUrl: 'https://example.test/v1',
  model: 'embedding-test',
})));

vi.mock('../../models/embedding-config', () => ({
  getEmbeddingModelName: vi.fn(() => 'embedding-test'),
  loadEmbeddingConfig,
}));
vi.mock('../../models/complete-chat', () => ({
  completeChat: (...args: unknown[]) => completeChat(...args),
}));

import { DEFAULT_EMBEDDING_TIMEOUT_MS, embedText, embedTexts } from '../embedding';
import { DEFAULT_HYDE_TIMEOUT_MS, generateHydeQuery } from '../hyde';

describe('RAG request timeouts', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    completeChat.mockReset();
    loadEmbeddingConfig.mockReset();
    loadEmbeddingConfig.mockReturnValue({
      apiKey: 'test-key',
      baseUrl: 'https://example.test/v1',
      model: 'embedding-test',
    });
  });

  it('bounds a non-responsive embedding request', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));

    const pending = embedText('测试查询');
    const assertion = expect(pending).rejects.toThrow('Embedding 请求超时');
    await vi.advanceTimersByTimeAsync(DEFAULT_EMBEDDING_TIMEOUT_MS);
    await assertion;
  });

  it('uses one configuration snapshot for every batch in an embedding operation', async () => {
    loadEmbeddingConfig.mockReturnValueOnce({
      apiKey: 'key-a',
      baseUrl: 'https://embedding-a.test/v1',
      model: 'model-a',
    });
    const fetchMock = vi.fn()
      .mockImplementationOnce(async () => {
        loadEmbeddingConfig.mockReturnValue({
          apiKey: 'key-b',
          baseUrl: 'https://embedding-b.test/v1',
          model: 'model-b',
        });
        return {
          ok: true,
          json: async () => ({
            data: Array.from({ length: 10 }, () => ({ embedding: [1, 0] })),
          }),
        };
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ embedding: [1, 0] }] }),
      });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      embedTexts(Array.from({ length: 11 }, (_, index) => `text-${index}`)),
    ).resolves.toHaveLength(11);

    expect(loadEmbeddingConfig).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url, request] of fetchMock.mock.calls) {
      expect(url).toBe('https://embedding-a.test/v1/embeddings');
      expect(request).toEqual(expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer key-a' }),
      }));
      expect(JSON.parse(String(request.body))).toEqual(
        expect.objectContaining({ model: 'model-a' }),
      );
    }
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
