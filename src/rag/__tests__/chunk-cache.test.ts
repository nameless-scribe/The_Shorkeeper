import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCachedChunkEmbeddings,
  invalidateChunkCache,
  resetChunkCacheForTest,
} from '../chunk-cache';
import * as documents from '../documents';

vi.mock('../documents', async (importOriginal) => {
  const actual = await importOriginal<typeof documents>();
  return {
    ...actual,
    loadAllChunkEmbeddings: vi.fn(() => [
      {
        id: 'c1',
        documentId: 'd1',
        chunkIndex: 0,
        content: 'hello',
        filename: 'a.md',
        embedding: new Float32Array([1, 0]),
      },
    ]),
  };
});

describe('chunk-cache', () => {
  beforeEach(() => {
    resetChunkCacheForTest();
    vi.mocked(documents.loadAllChunkEmbeddings).mockClear();
  });

  afterEach(() => {
    resetChunkCacheForTest();
  });

  it('loads from DB only once until invalidated', () => {
    const first = getCachedChunkEmbeddings();
    const second = getCachedChunkEmbeddings();
    expect(first).toHaveLength(1);
    expect(second).toBe(first);
    expect(documents.loadAllChunkEmbeddings).toHaveBeenCalledTimes(1);
  });

  it('reloads after invalidate', () => {
    getCachedChunkEmbeddings();
    invalidateChunkCache();
    getCachedChunkEmbeddings();
    expect(documents.loadAllChunkEmbeddings).toHaveBeenCalledTimes(2);
  });
});
