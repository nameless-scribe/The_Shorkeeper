import { getPerformanceSettings } from '../config/performance';
import { embedText } from './embedding';
import { getCachedChunkEmbeddings } from './chunk-cache';
import { listDocuments, searchChunksFts, type DocumentInfo } from './documents';
import { ranksFromOrderedIds, reciprocalRankFusion } from './hybrid';
import { SqlJsEmbeddingStore } from './sqljs-embedding-store';
import { cosineSimilarity } from './vector';

export interface RetrievedChunk {
  documentId: string;
  filename: string;
  chunkIndex: number;
  content: string;
  score: number;
}

const DENSE_CANDIDATES = 20;
const SPARSE_CANDIDATES = 20;
const embeddingStore = new SqlJsEmbeddingStore();

let lastRetrieveCache: {
  query: string;
  at: number;
  chunks: RetrievedChunk[];
} | null = null;

type ChunkCandidate = {
  id: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  filename: string;
  denseScore: number;
  rrfScore: number;
};

function applyDiverseLimit(
  items: ChunkCandidate[],
  k: number,
  maxPerDocument: number,
): ChunkCandidate[] {
  const docCounts = new Map<string, number>();
  const result: ChunkCandidate[] = [];

  for (const item of items) {
    if (result.length >= k) break;
    const count = docCounts.get(item.documentId) ?? 0;
    if (count >= maxPerDocument) continue;
    docCounts.set(item.documentId, count + 1);
    result.push(item);
  }

  return result;
}

export async function retrieveRelevantChunks(
  query: string,
  limit = 5,
  options?: { skipCache?: boolean },
): Promise<RetrievedChunk[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  if (
    !options?.skipCache &&
    lastRetrieveCache &&
    lastRetrieveCache.query === trimmed &&
    Date.now() - lastRetrieveCache.at < 60_000
  ) {
    return lastRetrieveCache.chunks.slice(0, limit);
  }

  const settings = getPerformanceSettings();
  const minScore = settings.ragMinScore;
  const maxPerDocument = settings.ragMaxChunksPerDoc;

  const stored = getCachedChunkEmbeddings();
  if (!stored.length) return [];

  const queryVec = new Float32Array(await embedText(trimmed));
  const byId = new Map(stored.map((s) => [s.id, s]));

  const denseRecords = await embeddingStore.search(queryVec, DENSE_CANDIDATES);
  const denseHits = denseRecords
    .map((r) => {
      const item = byId.get(r.id);
      if (!item) return null;
      return { item, score: cosineSimilarity(queryVec, r.embedding) };
    })
    .filter((h): h is { item: (typeof stored)[0]; score: number } => h !== null);

  const denseScoreById = new Map(denseHits.map((h) => [h.item.id, h.score]));
  const sparseHits = searchChunksFts(trimmed, SPARSE_CANDIDATES);
  const sparseIds = new Set(sparseHits.map((h) => h.chunkId));

  let candidateIds: string[];
  let rrfById = new Map<string, number>();

  if (sparseHits.length) {
    const denseRanks = ranksFromOrderedIds(denseHits.map((h) => h.item.id));
    const sparseRanks = ranksFromOrderedIds(sparseHits.map((h) => h.chunkId));
    rrfById = reciprocalRankFusion(denseRanks, sparseRanks);
    candidateIds = [...rrfById.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);
  } else {
    candidateIds = denseHits.map((h) => h.item.id);
  }

  const candidates: ChunkCandidate[] = [];

  for (const id of candidateIds) {
    const storedChunk = byId.get(id);
    const sparse = sparseHits.find((h) => h.chunkId === id);
    const denseScore = denseScoreById.get(id) ?? 0;

    const passesThreshold =
      denseScore >= minScore || (sparseIds.has(id) && sparseHits.length > 0);
    if (!passesThreshold) continue;

    if (storedChunk) {
      candidates.push({
        id: storedChunk.id,
        documentId: storedChunk.documentId,
        chunkIndex: storedChunk.chunkIndex,
        content: storedChunk.content,
        filename: storedChunk.filename,
        denseScore,
        rrfScore: rrfById.get(id) ?? denseScore,
      });
    } else if (sparse) {
      candidates.push({
        id: sparse.chunkId,
        documentId: sparse.documentId,
        chunkIndex: sparse.chunkIndex,
        content: sparse.content,
        filename: sparse.filename,
        denseScore: 0,
        rrfScore: rrfById.get(id) ?? 0,
      });
    }
  }

  const diverse = applyDiverseLimit(candidates, limit, maxPerDocument);

  const result = diverse.map((c) => ({
    documentId: c.documentId,
    filename: c.filename,
    chunkIndex: c.chunkIndex,
    content: c.content,
    score: sparseHits.length ? c.rrfScore : c.denseScore,
  }));

  lastRetrieveCache = { query: trimmed, at: Date.now(), chunks: result };
  return result;
}

export function formatDocumentCatalogForPrompt(documents: DocumentInfo[]): string | null {
  if (!documents.length) return null;

  const lines = documents.map((d, i) => `${i + 1}. ${d.filename}`);

  return (
    '【已导入知识库】\n' +
    '以下文档可供 search_knowledge 检索；回答业务/需求问题时请依据检索结果，勿声称没有知识库：\n\n' +
    lines.join('\n')
  );
}

export function formatRagChunksForTool(chunks: RetrievedChunk[]): string {
  return chunks
    .map(
      (c, i) =>
        `[${i + 1}] ${c.filename}#${c.chunkIndex} (相关度 ${c.score.toFixed(2)})\n${c.content}`,
    )
    .join('\n\n');
}

export function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function formatRagForPrompt(chunks: RetrievedChunk[]): string | null {
  if (!chunks.length) return null;

  const body = chunks
    .map(
      (c, i) =>
        `<ref index="${i + 1}" source="${escapeXmlAttr(c.filename)}" score="${c.score.toFixed(2)}">\n${c.content}\n</ref>`,
    )
    .join('\n\n');

  return `【参考文档】\n以下是从用户导入文档中检索到的相关片段，回答时请优先依据这些内容，并注明来源文件名：\n\n<reference>\n${body}\n</reference>`;
}
