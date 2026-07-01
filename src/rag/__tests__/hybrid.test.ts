import { describe, expect, it } from 'vitest';
import { ranksFromOrderedIds, reciprocalRankFusion } from '../hybrid';

describe('hybrid retrieval', () => {
  it('reciprocalRankFusion merges rankings', () => {
    const dense = ranksFromOrderedIds(['a', 'b', 'c']);
    const sparse = ranksFromOrderedIds(['b', 'a', 'd']);
    const fused = reciprocalRankFusion(dense, sparse);

    expect(fused.get('b')!).toBeGreaterThan(fused.get('c')!);
    expect(fused.get('a')!).toBeGreaterThan(0);
    expect(fused.has('d')).toBe(true);
  });

  it('keyword-only hit gets non-zero RRF score', () => {
    const dense = ranksFromOrderedIds(['x']);
    const sparse = ranksFromOrderedIds(['y']);
    const fused = reciprocalRankFusion(dense, sparse);
    expect(fused.get('y')!).toBeCloseTo(1 / 61);
  });
});
