import { describe, expect, it } from 'vitest';
import { CHUNK_OVERLAP, CHUNK_SIZE, splitMarkdownIntoChunks, splitTextIntoChunks } from '../chunker';

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

  it('splitMarkdownIntoChunks respects headings and code blocks', () => {
    const md = `# Title

## Section A
- item one
- item two

\`\`\`ts
const x = 1;
const y = 2;
\`\`\`

## Section B
More content here.`;

    const chunks = splitMarkdownIntoChunks(md);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const codeChunk = chunks.find((c) => c.includes('const x = 1'));
    expect(codeChunk).toBeDefined();
    expect(codeChunk).toContain('const y = 2');
    expect(chunks.some((c) => c.includes('Section A'))).toBe(true);
  });
});
