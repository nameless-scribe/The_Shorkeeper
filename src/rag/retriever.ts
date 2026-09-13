import { getPerformanceSettings, type PerformanceSettings } from '../config/performance';
import { getEmbeddingModelName } from '../models/embedding-config';
import { embedText } from './embedding';
import { getCachedChunkEmbeddings, getChunkCacheVersion } from './chunk-cache';
import { getCachedDocEmbeddings, getDocumentCount } from './doc-cache';
import {
  getAdjacentChunks,
  searchChunksFts,
  type DocumentInfo,
  type FtsSearchHit,
} from './documents';
import { ranksFromOrderedIds, reciprocalRankFusion } from './hybrid';
import { generateHydeQuery } from './hyde';
import { rerankChunks } from './reranker';
import { isFtsStrongHit } from './sparse-search';
import { SqlJsEmbeddingStore } from './sqljs-embedding-store';
import { cosineSimilarity, topKBySimilarity } from './vector';

export interface RetrievedChunk {
  documentId: string;
  filename: string;
  chunkIndex: number;
  content: string;
  score: number;
  documentVersion?: number;
  freshnessStatus?: DocumentInfo['freshnessStatus'];
  lastCheckedAt?: number | null;
}

const DENSE_CANDIDATES = 20;
const SPARSE_CANDIDATES = 20;
const FTS_STRONG_THRESHOLD = -3.0;
export const MAX_RAG_QUERY_CHARS = 4000;
const MAX_RETRIEVAL_LIMIT = 20;
const embeddingStore = new SqlJsEmbeddingStore();

let lastRetrieveCache: {
  query: string;
  at: number;
  chunkCacheVersion: number;
  settingsKey: string;
  limit: number;
  skipHyde: boolean;
  chunks: RetrievedChunk[];
} | null = null;

function retrievalSettingsKey(settings: PerformanceSettings): string {
  return JSON.stringify({
    minScore: settings.ragMinScore,
    maxPerDocument: settings.ragMaxChunksPerDoc,
    neighborWindow: settings.ragNeighborWindow,
    ftsFirst: settings.ragFtsFirst,
    docRouteTopK: settings.ragDocRouteTopK,
    docRouteMinDocs: settings.ragDocRouteMinDocs,
    rerankEnabled: settings.ragRerankEnabled,
    rerankTopK: settings.ragRerankTopK,
    hydeEnabled: settings.ragHydeEnabled,
    embeddingModel: getEmbeddingModelName(),
  });
}

function normalizeRetrievalLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 5;
  return Math.max(1, Math.min(MAX_RETRIEVAL_LIMIT, Math.floor(limit)));
}

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

function expandNeighborContent(
  documentId: string,
  chunkIndex: number,
  content: string,
  window: number,
): string {
  if (window <= 0) return content;

  const neighbors = getAdjacentChunks(documentId, chunkIndex, window);
  if (neighbors.length <= 1) return content;

  return neighbors.map((n) => n.content).join('\n\n');
}

function expandResultsWithNeighbors(
  hits: ChunkCandidate[],
  window: number,
): RetrievedChunk[] {
  return hits.map((c) => ({
    documentId: c.documentId,
    filename: c.filename,
    chunkIndex: c.chunkIndex,
    content: expandNeighborContent(c.documentId, c.chunkIndex, c.content, window),
    score: c.rrfScore || c.denseScore,
  }));
}

function resolveDocRouteIds(queryVec: Float32Array, topK: number, minDocs: number): string[] | undefined {
  if (getDocumentCount() < minDocs) return undefined;

  const docEmbeddings = getCachedDocEmbeddings();
  if (!docEmbeddings.length) return undefined;

  const hits = topKBySimilarity(
    queryVec,
    docEmbeddings.map((d) => ({ data: d, embedding: d.embedding })),
    topK,
  );

  const ids = hits.map((h) => h.item.id);
  return ids.length ? ids : undefined;
}

function sparseHitsToCandidates(
  sparseHits: FtsSearchHit[],
  limit: number,
  maxPerDocument: number,
): RetrievedChunk[] {
  const docCounts = new Map<string, number>();
  const results: RetrievedChunk[] = [];

  for (const hit of sparseHits) {
    if (results.length >= limit) break;
    const count = docCounts.get(hit.documentId) ?? 0;
    if (count >= maxPerDocument) continue;
    docCounts.set(hit.documentId, count + 1);
    results.push({
      documentId: hit.documentId,
      filename: hit.filename,
      chunkIndex: hit.chunkIndex,
      content: hit.content,
      score: hit.score ?? 1,
    });
  }

  return results;
}

async function retrieveHybridInternal(
  trimmed: string,
  limit: number,
  skipEmbed: boolean,
  settings: PerformanceSettings,
  queryVecOverride?: Float32Array,
  signal?: AbortSignal,
): Promise<RetrievedChunk[]> {
  const minScore = settings.ragMinScore;
  const maxPerDocument = settings.ragMaxChunksPerDoc;
  const neighborWindow = settings.ragNeighborWindow;
  const rerankTopK = settings.ragRerankTopK;

  const stored = getCachedChunkEmbeddings();
  if (!stored.length) return [];

  const queryVec =
    queryVecOverride ??
    (skipEmbed ? null : new Float32Array(await embedText(trimmed, signal)));
  if (!queryVec) return [];

  const routeDocIds = resolveDocRouteIds(
    queryVec,
    settings.ragDocRouteTopK,
    settings.ragDocRouteMinDocs,
  );
  const searchFilter = routeDocIds ? { documentIds: routeDocIds } : undefined;

  const byId = new Map(stored.map((s) => [s.id, s]));

  const denseRecords = await embeddingStore.search(queryVec, DENSE_CANDIDATES, searchFilter);
  const denseHits = denseRecords
    .map((r) => {
      const item = byId.get(r.id);
      if (!item) return null;
      return { item, score: cosineSimilarity(queryVec, r.embedding) };
    })
    .filter((h): h is { item: (typeof stored)[0]; score: number } => h !== null);

  const denseScoreById = new Map(denseHits.map((h) => [h.item.id, h.score]));
  const sparseHits = searchChunksFts(trimmed, SPARSE_CANDIDATES, routeDocIds);
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

  const recallLimit = settings.ragRerankEnabled ?
      Math.max(limit, rerankTopK)
    : limit;
  const diverse = applyDiverseLimit(candidates, recallLimit, maxPerDocument);
  let result = expandResultsWithNeighbors(diverse, neighborWindow);

  if (settings.ragRerankEnabled && result.length > limit) {
    result = await rerankChunks(trimmed, result, limit, true);
  } else {
    result = result.slice(0, limit);
  }

  return result;
}

export async function retrieveRelevantChunks(
  query: string,
  limit = 5,
  options?: { skipCache?: boolean; skipHyde?: boolean; signal?: AbortSignal },
): Promise<RetrievedChunk[]> {
  const trimmed = query.trim().slice(0, MAX_RAG_QUERY_CHARS);
  if (!trimmed) return [];
  const normalizedLimit = normalizeRetrievalLimit(limit);
  const settings = getPerformanceSettings();
  const settingsKey = retrievalSettingsKey(settings);
  const skipHyde = Boolean(options?.skipHyde);

  if (
    !options?.skipCache &&
    lastRetrieveCache &&
    lastRetrieveCache.query === trimmed &&
    lastRetrieveCache.chunkCacheVersion === getChunkCacheVersion() &&
    lastRetrieveCache.settingsKey === settingsKey &&
    lastRetrieveCache.limit === normalizedLimit &&
    lastRetrieveCache.skipHyde === skipHyde &&
    Date.now() - lastRetrieveCache.at < 60_000
  ) {
    return lastRetrieveCache.chunks.slice();
  }
  const retrievalCacheVersion = getChunkCacheVersion();

  const maxPerDocument = settings.ragMaxChunksPerDoc;
  const neighborWindow = settings.ragNeighborWindow;

  if (settings.ragFtsFirst) {
    const sparseHits = searchChunksFts(trimmed, SPARSE_CANDIDATES);
    if (isFtsStrongHit(sparseHits, FTS_STRONG_THRESHOLD)) {
      let sparseResults = sparseHitsToCandidates(sparseHits, normalizedLimit, maxPerDocument);
      if (neighborWindow > 0) {
        sparseResults = sparseResults.map((hit) => ({
          ...hit,
          content: expandNeighborContent(
            hit.documentId,
            hit.chunkIndex,
            hit.content,
            neighborWindow,
          ),
        }));
      }
      if (retrievalCacheVersion !== getChunkCacheVersion()) return [];
      lastRetrieveCache = {
        query: trimmed,
        at: Date.now(),
        chunkCacheVersion: retrievalCacheVersion,
        settingsKey,
        limit: normalizedLimit,
        skipHyde,
        chunks: sparseResults,
      };
      return sparseResults;
    }
  }

  let result = await retrieveHybridInternal(
    trimmed,
    normalizedLimit,
    false,
    settings,
    undefined,
    options?.signal,
  );

  if (!result.length && settings.ragHydeEnabled && !skipHyde) {
    try {
      const hydeQuery = await generateHydeQuery(trimmed, options?.signal);
      if (hydeQuery && hydeQuery !== trimmed) {
        const hydeVec = new Float32Array(await embedText(hydeQuery, options?.signal));
        result = await retrieveHybridInternal(
          trimmed,
          normalizedLimit,
          true,
          settings,
          hydeVec,
          options?.signal,
        );
      }
    } catch {
      if (options?.signal?.aborted) throw new Error('已取消');
      /* HyDE 失败时保持空结果 */
    }
  }

  if (retrievalCacheVersion !== getChunkCacheVersion()) return [];
  lastRetrieveCache = {
    query: trimmed,
    at: Date.now(),
    chunkCacheVersion: retrievalCacheVersion,
    settingsKey,
    limit: normalizedLimit,
    skipHyde,
    chunks: result,
  };
  return result;
}

export function formatDocumentCatalogForPrompt(documents: DocumentInfo[]): string | null {
  if (!documents.length) return null;

  const lines = documents.map((d, i) => {
    const summary = d.summary?.trim();
    const freshness = d.sourceKind === 'snapshot'
      ? '独立快照'
      : d.freshnessStatus === 'current' ? '来源已检查'
        : `来源状态：${d.freshnessStatus}`;
    return summary ?
        `${i + 1}. ${d.filename} — ${summary}（v${d.version}，${freshness}）`
      : `${i + 1}. ${d.filename}（v${d.version}，${freshness}）`;
  });

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
        `<ref index="${i + 1}" ref="doc:${escapeXmlAttr(c.documentId)}#chunk:${c.chunkIndex}" source="${escapeXmlAttr(c.filename)}" version="${c.documentVersion ?? 1}" freshness="${c.freshnessStatus ?? 'unknown'}" checked_at="${c.lastCheckedAt ?? ''}" score="${c.score.toFixed(2)}">\n${c.content}\n</ref>`,
    )
    .join('\n\n');

  return `【参考文档】\n以下是从用户导入文档中检索到的相关片段。使用片段事实时，请在相关句末附上对应 ref（例如 〔doc:…#chunk:0〕）；freshness 非 current/snapshot 时还要明确提醒来源文件可能已变化：\n\n<reference>\n${body}\n</reference>`;
}
