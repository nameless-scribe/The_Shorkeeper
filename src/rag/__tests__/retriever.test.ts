import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../embedding', () => ({
  embedText: vi.fn(async () => [1, 0, 0]),
}));

vi.mock('../chunk-cache', () => ({
  getCachedChunkEmbeddings: vi.fn(() => [
    {
      id: 'c1',
      documentId: 'd1',
      chunkIndex: 0,
      content: 'alpha beta content',
      filename: 'doc.md',
      embedding: new Float32Array([1, 0, 0]),
    },
    {
      id: 'c2',
      documentId: 'd1',
      chunkIndex: 1,
      content: 'gamma delta',
      filename: 'doc.md',
      embedding: new Float32Array([0.9, 0.1, 0]),
    },
  ]),
}));

vi.mock('../documents', () => ({
  listDocuments: vi.fn(() => []),
  searchChunksFts: vi.fn(() => []),
}));

vi.mock('../../config/performance', () => ({
  getPerformanceSettings: vi.fn(() => ({
    ragMinScore: 0.35,
    ragMaxChunksPerDoc: 2,
  })),
}));

import { retrieveRelevantChunks } from '../retriever';

describe('retrieveRelevantChunks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns dense hits above threshold', async () => {
    const chunks = await retrieveRelevantChunks('alpha', 5, { skipCache: true });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].filename).toBe('doc.md');
    expect(chunks[0].chunkIndex).toBe(0);
  });

  it('reuses cache for identical query within TTL', async () => {
    const first = await retrieveRelevantChunks('alpha', 5);
    const second = await retrieveRelevantChunks('alpha', 5);
    expect(second).toEqual(first);
  });
});
