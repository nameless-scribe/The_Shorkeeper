import type { RetrievedChunk } from './retriever';

export interface RerankCandidate {
  query: string;
  content: string;
  chunk: RetrievedChunk;
}

export interface Reranker {
  rerank(query: string, candidates: RetrievedChunk[], topK: number): Promise<RetrievedChunk[]>;
}

/** No-op reranker; swap for ONNX cross-encoder when ragRerankEnabled and model is bundled. */
export class PassthroughReranker implements Reranker {
  async rerank(_query: string, candidates: RetrievedChunk[], topK: number): Promise<RetrievedChunk[]> {
    return candidates.slice(0, topK);
  }
}

let reranker: Reranker = new PassthroughReranker();

export function getReranker(): Reranker {
  return reranker;
}

/** @internal test hook */
export function setRerankerForTest(instance: Reranker): void {
  reranker = instance;
}

export async function rerankChunks(
  query: string,
  candidates: RetrievedChunk[],
  topK: number,
  enabled: boolean,
): Promise<RetrievedChunk[]> {
  if (!enabled || candidates.length <= topK) {
    return candidates.slice(0, topK);
  }
  return getReranker().rerank(query, candidates, topK);
}
