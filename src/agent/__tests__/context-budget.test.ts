import { describe, expect, it } from 'vitest';
import {
  applyContextSectionBudget,
  estimateTokens,
  trimMessagesToTokenBudget,
  truncateToTokenBudget,
} from '../context-budget';

describe('context budget', () => {
  it('estimates Chinese text more conservatively than ASCII', () => {
    expect(estimateTokens('这是中文测试')).toBeGreaterThan(estimateTokens('abcdef'));
  });

  it('keeps required and higher-priority sections first', () => {
    const result = applyContextSectionBudget([
      { id: 'persona', text: '必须保留'.repeat(10), priority: 100, required: true },
      { id: 'memory', text: '长期记忆'.repeat(20), priority: 40 },
      { id: 'rag', text: '参考文档'.repeat(20), priority: 80 },
    ], 85);

    expect(result.report.includedSectionIds).toContain('persona');
    expect(result.report.includedSectionIds).toContain('rag');
    expect(result.report.droppedSectionIds).toContain('memory');
    expect(result.report.estimatedTokens).toBeLessThanOrEqual(85);
  });

  it('deduplicates identical prompt sections', () => {
    const result = applyContextSectionBudget([
      { id: 'first', text: '相同内容', priority: 10 },
      { id: 'second', text: '相同内容', priority: 20 },
    ], 100);

    expect(result.sections).toHaveLength(1);
  });

  it('retains newest messages and trims older history', () => {
    const result = trimMessagesToTokenBudget([
      { role: 'user', content: '旧消息'.repeat(40) },
      { role: 'assistant', content: '中间消息'.repeat(40) },
      { role: 'user', content: '最新问题' },
    ], 30);

    expect(result.messages.at(-1)?.content).toBe('最新问题');
    expect(result.trimmedCount).toBeGreaterThan(0);
    expect(result.estimatedTokens).toBeLessThanOrEqual(30);
  });

  it('truncates an oversized latest message within the budget', () => {
    const result = trimMessagesToTokenBudget([
      { role: 'user', content: '很长的最新问题'.repeat(100) },
    ], 40);

    expect(result.truncatedLatest).toBe(true);
    expect(result.messages[0].content).toContain('上下文预算截断');
    expect(estimateTokens(result.messages[0].content) + 4).toBeLessThanOrEqual(40);
    expect(estimateTokens(truncateToTokenBudget('测试'.repeat(100), 20))).toBeLessThanOrEqual(20);
  });
});
