import { describe, expect, it, vi, beforeEach } from 'vitest';

const { embedTextMock, cacheState } = vi.hoisted(() => ({
  embedTextMock: vi.fn(async () => [1, 0, 0]),
  cacheState: { version: 0 },
}));

vi.mock('../embedding', () => ({
  embedText: embedTextMock,
}));

vi.mock('../chunk-cache', () => ({
  getChunkCacheVersion: vi.fn(() => cacheState.version),
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

vi.mock('../doc-cache', () => ({
  getCachedDocEmbeddings: vi.fn(() => []),
  getDocumentCount: vi.fn(() => 1),
}));

const getAdjacentChunks = vi.fn<
  (documentId: string, chunkIndex: number, window: number) => Array<{ chunkIndex: number; content: string }>
>(() => []);

vi.mock('../documents', () => ({
  listDocuments: vi.fn(() => []),
  searchChunksFts: vi.fn(() => []),
  getAdjacentChunks: (documentId: string, chunkIndex: number, window: number) =>
    getAdjacentChunks(documentId, chunkIndex, window),
}));

vi.mock('../hyde', () => ({
  generateHydeQuery: vi.fn(async () => 'hyde answer'),
}));

vi.mock('../../config/performance', () => ({
  getPerformanceSettings: vi.fn(() => ({
    ragMinScore: 0.35,
    ragMaxChunksPerDoc: 2,
    ragNeighborWindow: 1,
    ragFtsFirst: false,
    ragDocRouteTopK: 3,
    ragDocRouteMinDocs: 4,
    ragRerankEnabled: false,
    ragRerankTopK: 15,
    ragHydeEnabled: false,
  })),
}));

import { retrieveRelevantChunks, formatDocumentCatalogForPrompt } from '../retriever';

describe('retrieveRelevantChunks', () => {
  beforeEach(() => {
    cacheState.version = 0;
    vi.clearAllMocks();
    getAdjacentChunks.mockReturnValue([
      { chunkIndex: 0, content: 'alpha beta content' },
      { chunkIndex: 1, content: 'gamma delta' },
    ]);
  });

  it('returns dense hits above threshold', async () => {
    const chunks = await retrieveRelevantChunks('alpha', 5, { skipCache: true });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].filename).toBe('doc.md');
    expect(chunks[0].chunkIndex).toBe(0);
  });

  it('expands neighbor chunks when window > 0', async () => {
    const chunks = await retrieveRelevantChunks('alpha', 5, { skipCache: true });
    expect(getAdjacentChunks).toHaveBeenCalled();
    expect(chunks[0].content).toContain('gamma delta');
  });

  it('reuses cache for identical query within TTL', async () => {
    const first = await retrieveRelevantChunks('alpha', 5);
    const second = await retrieveRelevantChunks('alpha', 5);
    expect(second).toEqual(first);
  });

  it('passes the run abort signal into embedding retrieval', async () => {
    const controller = new AbortController();
    await retrieveRelevantChunks('signal query', 5, {
      skipCache: true,
      signal: controller.signal,
    });

    expect(embedTextMock).toHaveBeenCalledWith('signal query', controller.signal);
  });

  it('drops results if the document cache changes during retrieval', async () => {
    embedTextMock.mockImplementationOnce(async () => {
      cacheState.version += 1;
      return [1, 0, 0];
    });

    await expect(
      retrieveRelevantChunks('changed during retrieval', 5, { skipCache: true }),
    ).resolves.toEqual([]);
  });
});

describe('formatDocumentCatalogForPrompt', () => {
  it('includes summary when available', () => {
    const catalog = formatDocumentCatalogForPrompt([
      {
        id: '1',
        filename: '需求.md',
        filepath: 'knowledge/需求.md',
        mimeType: 'text/markdown',
        chunkCount: 3,
        importedAt: Date.now(),
        summary: '产品需求与登录模块说明',
        status: 'indexed',
        statusError: null,
        updatedAt: Date.now(),
        indexedAt: Date.now(),
        deletedAt: null,
        sourcePath: null,
        title: '需求',
        titleKey: '需求',
        version: 1,
        supersededBy: null,
        chunkSize: 800,
        chunkOverlap: 64,
      },
    ]);
    expect(catalog).toContain('需求.md — 产品需求与登录模块说明');
  });
});
