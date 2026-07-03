import { buildChunkEmbedText } from './chunk-prefix';
import { getCachedChunkEmbeddings } from './chunk-cache';

export interface SparseHit {
  chunkId: string;
  documentId: string;
  content: string;
  filename: string;
  chunkIndex: number;
  score: number;
}

function escapeFtsQuery(query: string): string {
  return query.replace(/"/g, '""');
}

export function extractSearchTerms(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const terms = new Set<string>();
  terms.add(trimmed);

  for (const token of trimmed.split(/[\s,，。！？、；;:：]+/)) {
    const t = token.trim();
    if (t.length >= 2) terms.add(t);
  }

  const cjkRuns = trimmed.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  for (const run of cjkRuns) {
    terms.add(run);
    if (run.length >= 4) {
      for (let i = 0; i <= run.length - 2; i++) {
        terms.add(run.slice(i, i + 2));
      }
    }
  }

  return [...terms].filter((t) => t.length >= 2);
}

export function scoreChunkForTerms(
  embedText: string,
  filename: string,
  terms: string[],
): number {
  const haystack = `${filename}\n${embedText}`.toLowerCase();
  let score = 0;
  for (const term of terms) {
    const needle = term.toLowerCase();
    if (!needle) continue;
    if (haystack.includes(needle)) {
      score += needle.length >= 4 ? 3 : needle.length >= 2 ? 2 : 1;
    }
  }
  return score;
}

export function searchChunksSparseInMemory(query: string, limit: number): SparseHit[] {
  const terms = extractSearchTerms(query);
  if (!terms.length) return [];

  const stored = getCachedChunkEmbeddings();
  const scored: SparseHit[] = [];

  for (const item of stored) {
    const sectionMatch = item.content.match(/^#{1,3}\s+(.+?)(?:\n|$)/);
    const sectionTitle = sectionMatch?.[1]?.trim();
    const embedText = buildChunkEmbedText(item.filename, sectionTitle, item.content);
    const score = scoreChunkForTerms(embedText, item.filename, terms);
    if (score <= 0) continue;
    scored.push({
      chunkId: item.id,
      documentId: item.documentId,
      content: item.content,
      filename: item.filename,
      chunkIndex: item.chunkIndex,
      score,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

export function buildFtsMatchQuery(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return '';
  return `"${escapeFtsQuery(trimmed)}"`;
}

export function isFtsStrongHit(
  hits: Array<{ score?: number; rank?: number }>,
  threshold = -3.0,
): boolean {
  if (!hits.length) return false;
  const first = hits[0];
  if (first.rank != null) return first.rank < threshold;
  if (first.score != null) return first.score >= 4;
  return false;
}
