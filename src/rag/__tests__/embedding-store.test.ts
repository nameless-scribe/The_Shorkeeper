import { describe, expect, it, vi } from 'vitest';
import { SqlJsEmbeddingStore } from '../sqljs-embedding-store';
import * as chunkCache from '../chunk-cache';

vi.mock('../chunk-cache', () => ({
  getCachedChunkEmbeddings: vi.fn(() => [
    {
      id: 'c1',
      documentId: 'd1',
      chunkIndex: 0,
      content: 'alpha',
      filename: 'a.md',
      embedding: new Float32Array([1, 0, 0]),
    },
    {
      id: 'c2',
      documentId: 'd2',
      chunkIndex: 0,
      content: 'beta',
      filename: 'b.md',
      embedding: new Float32Array([0, 1, 0]),
    },
  ]),
}));

describe('SqlJsEmbeddingStore', () => {
  it('search returns top similar records', async () => {
    const store = new SqlJsEmbeddingStore();
    const results = await store.search(new Float32Array([1, 0, 0]), 1);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('c1');
    expect(chunkCache.getCachedChunkEmbeddings).toHaveBeenCalled();
  });
});
