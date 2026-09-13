import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../models/embedding-config', () => ({
  getEmbeddingModelName: vi.fn(() => 'embedding-test'),
  loadEmbeddingConfig: vi.fn(() => ({
    apiKey: 'test-key',
    baseUrl: 'https://embedding.test/v1',
    model: 'embedding-test',
  })),
}));

import {
  embedTexts,
  formatEmbeddingApiError,
  MAX_EMBEDDING_RESPONSE_BYTES,
} from '../embedding';

function embeddingResponse(vectors: unknown[]) {
  return {
    ok: true,
    json: async () => ({ data: vectors.map((embedding) => ({ embedding })) }),
  };
}

describe('embedding response validation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    { name: 'an empty vector', vectors: [[]], message: '返回空向量' },
    { name: 'a non-finite value', vectors: [[1, Number.NaN]], message: '非法向量数值' },
    { name: 'inconsistent dimensions', vectors: [[1, 0], [1, 0, 0]], message: '向量维度不一致' },
  ])('rejects $name', async ({ vectors, message }) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(embeddingResponse(vectors)));

    await expect(embedTexts(vectors.map((_, index) => `text-${index}`)))
      .rejects.toThrow(message);
  });

  it('rejects dimension changes between API batches', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(embeddingResponse(
        Array.from({ length: 10 }, () => [1, 0]),
      ))
      .mockResolvedValueOnce(embeddingResponse([[1, 0, 0]])));

    await expect(embedTexts(Array.from({ length: 11 }, (_, index) => `text-${index}`)))
      .rejects.toThrow('分批返回的向量维度不一致');
  });

  it('rejects an oversized response before buffering its body', async () => {
    const response = new Response('{}', {
      headers: { 'content-length': String(MAX_EMBEDDING_RESPONSE_BYTES + 1) },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

    await expect(embedTexts(['oversized response']))
      .rejects.toThrow('响应超过大小上限');
  });

  it('does not expose an unknown upstream error body', () => {
    expect(formatEmbeddingApiError(500, 'internal secret token=abc'))
      .toBe('Embeddings API 500：请求失败');
  });
});
