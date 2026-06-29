import { describe, expect, it } from 'vitest';
import {
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
  it('detects knowledge-like queries', () => {
    expect(looksLikeKnowledgeQuery('你好')).toBe(false);
    expect(looksLikeKnowledgeQuery('伸宏贸易关账日是什么？')).toBe(true);
    expect(looksLikeKnowledgeQuery('请总结文档里的数据治理流程')).toBe(true);
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
});
