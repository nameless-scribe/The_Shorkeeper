import { describe, expect, it } from 'vitest';
import { loadMammoth, loadWordExtractor } from '../doc-loaders';

const DOCUMENT_LOADER_TIMEOUT_MS = 20_000;

describe('loadMammoth', () => {
  it('returns a module with extractRawText', async () => {
    const mammoth = await loadMammoth();
    expect(typeof mammoth.extractRawText).toBe('function');
  }, DOCUMENT_LOADER_TIMEOUT_MS);
});

describe('loadWordExtractor', () => {
  it('returns a constructible WordExtractor class', async () => {
    const WordExtractor = await loadWordExtractor();
    expect(typeof WordExtractor).toBe('function');
    const extractor = new WordExtractor();
    expect(typeof extractor.extract).toBe('function');
  }, DOCUMENT_LOADER_TIMEOUT_MS);
});
