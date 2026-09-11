import { describe, expect, it } from 'vitest';
import {
  isCasualChat,
  looksLikeKnowledgeQuery,
  shouldAutoRetrieveRag,
  shouldInjectRagCatalog,
  type PerformanceSettings,
} from '../performance';

const baseSettings: PerformanceSettings = {
  ragEnabled: true,
  ragInjectMode: 'catalog',
  ragMinScore: 0.35,
  ragMaxChunksPerDoc: 2,
  ragArchiveDedupeThreshold: 0.92,
  ragNeighborWindow: 1,
  ragFtsFirst: true,
  ragDocRouteTopK: 3,
  ragDocRouteMinDocs: 4,
  ragRerankEnabled: false,
  ragRerankTopK: 15,
  ragHydeEnabled: false,
  memoryExtractMode: 'always',
  memoryExtractInterval: 3,
  maxHistoryMessages: 20,
  compressThreshold: 30,
  contextMaxInputTokens: 24_000,
  memorySemanticInContext: true,
  proactivityEnabled: true,
  quietHoursStart: '',
  quietHoursEnd: '',
  notificationDedupMinutes: 5,
};

describe('performance config', () => {
  it('detects casual chat', () => {
    expect(isCasualChat('你好')).toBe(true);
    expect(isCasualChat('谢谢')).toBe(true);
    expect(isCasualChat('OA')).toBe(false);
    expect(isCasualChat('知识库里有什么')).toBe(false);
  });

  it('looksLikeKnowledgeQuery detects question patterns', () => {
    expect(looksLikeKnowledgeQuery('你好')).toBe(false);
    expect(looksLikeKnowledgeQuery('需求文档里登录流程是什么？')).toBe(true);
    expect(looksLikeKnowledgeQuery('OA')).toBe(false);
    expect(looksLikeKnowledgeQuery('帮我看看 requirements.md', ['requirements.md'])).toBe(
      true,
    );
  });

  it('catalog mode injects catalog but not auto retrieve', () => {
    expect(shouldInjectRagCatalog(true, baseSettings)).toBe(true);
    expect(
      shouldAutoRetrieveRag('需求文档里登录流程是什么？', true, [], baseSettings),
    ).toBe(false);
  });

  it('auto mode retrieves for knowledge queries', () => {
    const auto = { ...baseSettings, ragInjectMode: 'auto' as const };
    expect(shouldAutoRetrieveRag('需求文档里登录流程是什么？', true, [], auto)).toBe(true);
    expect(shouldAutoRetrieveRag('你好', true, [], auto)).toBe(false);
    expect(shouldAutoRetrieveRag('OA', true, [], auto)).toBe(false);
  });

  it('tool mode skips catalog and auto retrieve', () => {
    const tool = { ...baseSettings, ragInjectMode: 'tool' as const };
    expect(shouldInjectRagCatalog(true, tool)).toBe(false);
    expect(shouldAutoRetrieveRag('关账日是什么？', true, [], tool)).toBe(false);
  });

  it('skips rag without documents', () => {
    const auto = { ...baseSettings, ragInjectMode: 'auto' as const };
    expect(shouldAutoRetrieveRag('关账日是什么？', false, [], auto)).toBe(false);
  });

  it('respects ragEnabled flag', () => {
    const disabled = { ...baseSettings, ragEnabled: false };
    expect(shouldInjectRagCatalog(true, disabled)).toBe(false);
    expect(
      shouldAutoRetrieveRag('文档里关账日是什么？', true, [], {
        ...disabled,
        ragInjectMode: 'auto',
      }),
    ).toBe(false);
  });
});
