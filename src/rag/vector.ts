export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    console.warn(`[vector] embedding 维度不匹配: ${a.length} vs ${b.length}`);
    return 0;
  }
  if (a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function serializeEmbedding(values: number[]): Uint8Array {
  return new Uint8Array(new Float32Array(values).buffer);
}

export function deserializeEmbedding(bytes: Uint8Array): Float32Array {
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

export interface Scored<T> {
  item: T;
  score: number;
}

export function topKBySimilarity<T>(
  query: Float32Array,
  items: Array<{ data: T; embedding: Float32Array }>,
  k: number,
): Scored<T>[] {
  const scored = items.map(({ data, embedding }) => ({
    item: data,
    score: cosineSimilarity(query, embedding),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

export function topKBySimilarityDiverse<T extends { documentId: string }>(
  query: Float32Array,
  items: Array<{ data: T; embedding: Float32Array }>,
  k: number,
  maxPerDocument = 2,
): Scored<T>[] {
  const scored = items.map(({ data, embedding }) => ({
    item: data,
    score: cosineSimilarity(query, embedding),
  }));
  scored.sort((a, b) => b.score - a.score);

  const docCounts = new Map<string, number>();
  const result: Scored<T>[] = [];

  for (const hit of scored) {
    if (result.length >= k) break;
    const docId = hit.item.documentId;
    const count = docCounts.get(docId) ?? 0;
    if (count >= maxPerDocument) continue;
    docCounts.set(docId, count + 1);
    result.push(hit);
  }

  return result;
}
