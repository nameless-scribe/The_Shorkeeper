import { describe, expect, it, vi } from 'vitest';
import * as chunkCache from '../chunk-cache';
import { extractSearchTerms, scoreChunkForTerms, searchChunksSparseInMemory } from '../sparse-search';

describe('sparse-search', () => {
  it('extractSearchTerms includes Chinese substrings', () => {
    const terms = extractSearchTerms('登录流程');
    expect(terms).toContain('登录流程');
    expect(terms).toContain('登录');
  });

  it('scoreChunkForTerms matches Chinese content', () => {
    const score = scoreChunkForTerms(
      '[手册.md > 登录]\n\n用户登录支持验证码',
      '手册.md',
      ['登录'],
    );
    expect(score).toBeGreaterThan(0);
  });
});

describe('searchChunksSparseInMemory', () => {
  it('returns hits for Chinese query', () => {
    vi.spyOn(chunkCache, 'getCachedChunkEmbeddings').mockReturnValue([
      {
        id: 'c1',
        documentId: 'd1',
        chunkIndex: 0,
        content: '# 登录流程\n\n用户登录支持手机号验证码。',
        filename: '需求.md',
        embedding: new Float32Array([1, 0]),
      },
    ]);

    const hits = searchChunksSparseInMemory('登录流程', 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].chunkId).toBe('c1');

    vi.restoreAllMocks();
  });
});
