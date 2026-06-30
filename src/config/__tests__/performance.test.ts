import { describe, expect, it } from 'vitest';
import {
  isCasualChat,
  looksLikeKnowledgeQuery,
  shouldRunRag,
  type PerformanceSettings,
} from '../performance';

const defaultSettings: PerformanceSettings = {
  ragEnabled: true,
  memoryExtractMode: 'always',
  memoryExtractInterval: 3,
  maxHistoryMessages: 20,
  compressThreshold: 30,
};

describe('performance config', () => {
  it('detects casual chat', () => {
    expect(isCasualChat('你好')).toBe(true);
    expect(isCasualChat('谢谢')).toBe(true);
    expect(isCasualChat('OA')).toBe(false);
    expect(isCasualChat('知识库里有什么')).toBe(false);
  });

  it('runs rag for any non-casual query when documents exist', () => {
    expect(shouldRunRag('OA', true, defaultSettings)).toBe(true);
    expect(shouldRunRag('知识库里现在有哪些内容', true, defaultSettings)).toBe(true);
    expect(shouldRunRag('伸宏贸易关账日是什么？', true, defaultSettings)).toBe(true);
  });

  it('skips rag without documents', () => {
    expect(shouldRunRag('关账日是什么', false, defaultSettings)).toBe(false);
  });

  it('skips rag for casual chat even with documents', () => {
    expect(shouldRunRag('谢谢', true, defaultSettings)).toBe(false);
  });

  it('respects ragEnabled flag', () => {
    expect(
      shouldRunRag('文档里关账日是什么？', true, { ...defaultSettings, ragEnabled: false }),
    ).toBe(false);
  });

  it('looksLikeKnowledgeQuery aligns with non-casual', () => {
    expect(looksLikeKnowledgeQuery('你好')).toBe(false);
    expect(looksLikeKnowledgeQuery('OA')).toBe(true);
  });
});
