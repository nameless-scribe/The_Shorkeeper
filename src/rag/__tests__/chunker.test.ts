import { describe, expect, it } from 'vitest';
import { CHUNK_OVERLAP, CHUNK_SIZE, splitTextIntoChunks } from '../chunker';

describe('splitTextIntoChunks', () => {
  it('returns empty for blank text', () => {
    expect(splitTextIntoChunks('   ')).toEqual([]);
  });

  it('returns single chunk for short text', () => {
    expect(splitTextIntoChunks('hello')).toEqual(['hello']);
  });

  it('splits long text with overlap', () => {
    const text = 'a'.repeat(CHUNK_SIZE + 100);
    const chunks = splitTextIntoChunks(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(CHUNK_SIZE);
    }
    expect(chunks[1].slice(0, CHUNK_OVERLAP)).toBe(chunks[0].slice(-CHUNK_OVERLAP));
  });

  it('does not infinite loop on edge case', () => {
    const chunks = splitTextIntoChunks('x'.repeat(CHUNK_SIZE));
    expect(chunks).toHaveLength(1);
  });
});
