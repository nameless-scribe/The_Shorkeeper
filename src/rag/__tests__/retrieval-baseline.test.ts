import { describe, expect, it } from 'vitest';
import { runRetrievalBaseline } from '../baseline/evaluator';
import { RETRIEVAL_BASELINE_CASES } from '../baseline/fixtures';

describe('fixed RAG retrieval baseline', () => {
  it('keeps 10-20 stable and uniquely named QA cases', () => {
    expect(RETRIEVAL_BASELINE_CASES.length).toBeGreaterThanOrEqual(10);
    expect(RETRIEVAL_BASELINE_CASES.length).toBeLessThanOrEqual(20);
    expect(new Set(RETRIEVAL_BASELINE_CASES.map((item) => item.id)).size)
      .toBe(RETRIEVAL_BASELINE_CASES.length);
  });

  it('records source recall and answer-readiness for catalog, auto, and tool modes', () => {
    const report = runRetrievalBaseline();
    expect(report.map((item) => item.mode)).toEqual(['catalog', 'auto', 'tool']);
    expect(report.every((item) => item.implementation === 'offline_sparse_proxy')).toBe(true);
    expect(report.every((item) => item.productionPathVerified === false)).toBe(true);
    expect(report.every((item) => item.caseCount === 12)).toBe(true);
    expect(report.find((item) => item.mode === 'catalog')).toEqual(
      expect.objectContaining({ sourceRecall: 1, averageFactCoverage: null, citationRate: null }),
    );
    for (const mode of ['auto', 'tool'] as const) {
      expect(report.find((item) => item.mode === mode)).toEqual(
        expect.objectContaining({ sourceRecall: 1, averageFactCoverage: 1, citationRate: 1 }),
      );
    }
  });

  it('makes regressions visible in per-case output', () => {
    const [result] = runRetrievalBaseline(
      ['tool'],
      [RETRIEVAL_BASELINE_CASES[0]],
      [{ filename: 'wrong.md', content: '没有相关事实。' }],
    );
    expect(result.sourceRecall).toBe(0);
    expect(result.averageFactCoverage).toBe(0);
    expect(result.cases[0].recalledSources).toEqual([]);
  });
});
