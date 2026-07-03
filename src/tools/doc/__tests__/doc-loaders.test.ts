import { describe, expect, it } from 'vitest';
import { loadMammoth, loadWordExtractor } from '../doc-loaders';

describe('loadMammoth', () => {
  it('returns a module with extractRawText', async () => {
    const mammoth = await loadMammoth();
    expect(typeof mammoth.extractRawText).toBe('function');
  });
});

describe('loadWordExtractor', () => {
  it('returns a constructible WordExtractor class', async () => {
    const WordExtractor = await loadWordExtractor();
    expect(typeof WordExtractor).toBe('function');
    const extractor = new WordExtractor();
    expect(typeof extractor.extract).toBe('function');
  });
});
