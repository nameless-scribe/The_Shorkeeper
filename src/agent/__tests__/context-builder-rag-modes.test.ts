import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  mode: 'catalog' as 'catalog' | 'auto' | 'tool',
  retrieve: vi.fn(async () => [{
    documentId: 'doc-1',
    filename: 'manual.md',
    chunkIndex: 0,
    content: '关键事实',
    score: 0.9,
  }]),
}));

vi.mock('../stable-context', () => ({
  getStableSystemPrefix: vi.fn(() => '稳定人设'),
  formatToolGuideForPrompt: vi.fn(() => null),
}));
vi.mock('../../memory/user-profile', () => ({ getProfileSummary: vi.fn(() => null) }));
vi.mock('../../memory/long-term', () => ({
  searchMemories: vi.fn(() => []),
  searchMemoriesWithEmbedding: vi.fn(async () => []),
  formatMemoriesForPrompt: vi.fn(() => null),
}));
vi.mock('../../memory/worldbook', () => ({
  matchWorldbook: vi.fn(() => []),
  formatWorldbookForPrompt: vi.fn(() => null),
}));
vi.mock('../../memory/session-context', () => ({
  getSessionSummary: vi.fn(() => null),
  formatSummaryForPrompt: vi.fn(() => null),
}));
vi.mock('../../affection', () => ({ formatAffectionForPrompt: vi.fn(() => '羁绊状态') }));
vi.mock('../../skills/loader', () => ({ formatSkillsForPrompt: vi.fn(() => null) }));
vi.mock('../../rag/documents', () => ({
  listIndexedDocuments: vi.fn(() => [{ id: 'doc-1', filename: 'manual.md' }]),
}));
vi.mock('../../rag/retriever', () => ({
  retrieveRelevantChunks: state.retrieve,
  formatDocumentCatalogForPrompt: vi.fn(() => '知识库目录'),
  formatRagForPrompt: vi.fn(() => 'RAG 参考片段'),
}));
vi.mock('../../config/performance', () => ({
  getPerformanceSettings: vi.fn(() => ({
    memorySemanticInContext: false,
    contextMaxInputTokens: 24_000,
    ragInjectMode: state.mode,
  })),
  shouldInjectRagCatalog: vi.fn(() => state.mode !== 'tool'),
  shouldAutoRetrieveRag: vi.fn(() => state.mode === 'auto'),
}));

import { buildSystemPromptParts } from '../context-builder';

describe('context-builder RAG budget modes', () => {
  beforeEach(() => {
    state.mode = 'catalog';
    state.retrieve.mockClear();
  });

  it('catalog mode injects only the document catalog', async () => {
    const parts = await buildSystemPromptParts({
      userMessage: '查看知识库',
      sessionId: 'session-1',
      assistantMode: 'review',
      availableTools: [],
      activeSkills: [],
      maxTokens: 1000,
    });

    expect(parts.budget.includedSectionIds).toContain('rag_catalog');
    expect(parts.stable).toContain('审核检查');
    expect(parts.stable).toContain('不改变工具权限');
    expect(parts.budget.includedSectionIds).not.toContain('rag_references');
    expect(state.retrieve).not.toHaveBeenCalled();
  });

  it('auto mode injects catalog and retrieved references', async () => {
    state.mode = 'auto';
    const parts = await buildSystemPromptParts({
      userMessage: '文档里的关键事实是什么？',
      sessionId: 'session-1',
      availableTools: [],
      activeSkills: [],
      maxTokens: 1000,
    });

    expect(parts.budget.includedSectionIds).toContain('rag_catalog');
    expect(parts.budget.includedSectionIds).toContain('rag_references');
    expect(state.retrieve).toHaveBeenCalledOnce();
  });

  it('tool mode leaves catalog and references to search_knowledge', async () => {
    state.mode = 'tool';
    const parts = await buildSystemPromptParts({
      userMessage: '查看知识库',
      sessionId: 'session-1',
      availableTools: [],
      activeSkills: [],
      maxTokens: 1000,
    });

    expect(parts.budget.includedSectionIds).not.toContain('rag_catalog');
    expect(parts.budget.includedSectionIds).not.toContain('rag_references');
    expect(state.retrieve).not.toHaveBeenCalled();
  });

  it('bounds long retrieval queries before sending them to RAG', async () => {
    state.mode = 'auto';
    const longQuery = '知识'.repeat(20_000);

    await buildSystemPromptParts({
      userMessage: longQuery,
      sessionId: 'session-1',
      availableTools: [],
      activeSkills: [],
      maxTokens: 1000,
    });

    expect(state.retrieve).toHaveBeenCalledWith(
      expect.any(String),
      5,
      expect.any(Object),
    );
    const calls = state.retrieve.mock.calls as unknown as Array<[string, number, unknown]>;
    expect(calls[0]?.[0].length).toBeLessThan(longQuery.length);
  });
});
