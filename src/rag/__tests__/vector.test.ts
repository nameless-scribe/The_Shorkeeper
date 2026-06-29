import { describe, expect, it } from 'vitest';
import {
  cosineSimilarity,
  deserializeEmbedding,
  serializeEmbedding,
  topKBySimilarity,
} from '../vector';

describe('vector utils', () => {
  it('cosineSimilarity: identical vectors = 1', () => {
    const a = new Float32Array([1, 0, 0]);
    expect(cosineSimilarity(a, a)).toBeCloseTo(1);
  });

  it('round-trips embedding serialization', () => {
    const original = [0.1, 0.2, 0.3];
    const restored = deserializeEmbedding(serializeEmbedding(original));
    const values = Array.from(restored);
    expect(values).toHaveLength(original.length);
    values.forEach((v, i) => expect(v).toBeCloseTo(original[i], 5));
  });

  it('topKBySimilarity returns highest scores first', () => {
    const query = new Float32Array([1, 0]);
    const results = topKBySimilarity(
      query,
      [
        { data: 'far', embedding: new Float32Array([0, 1]) },
        { data: 'near', embedding: new Float32Array([1, 0]) },
      ],
      1,
    );
    expect(results[0].item).toBe('near');
    expect(results[0].score).toBeCloseTo(1);
  });
});
