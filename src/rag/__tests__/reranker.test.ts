import { describe, expect, it } from 'vitest';
import { PassthroughReranker, rerankChunks } from '../reranker';
import type { RetrievedChunk } from '../retriever';

const sample: RetrievedChunk[] = [
  {
    documentId: 'd1',
    filename: 'a.md',
    chunkIndex: 0,
    content: 'first',
    score: 0.9,
  },
  {
    documentId: 'd1',
    filename: 'a.md',
    chunkIndex: 1,
    content: 'second',
    score: 0.8,
  },
];

describe('reranker', () => {
  it('passthrough reranker returns topK unchanged order', async () => {
    const reranker = new PassthroughReranker();
    const out = await reranker.rerank('q', sample, 1);
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe('first');
  });

  it('rerankChunks skips when disabled', async () => {
    const out = await rerankChunks('q', sample, 1, false);
    expect(out).toHaveLength(1);
  });
});
