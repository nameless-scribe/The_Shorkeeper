import {
  createMemory,
  getMemoryById,
  getMemoryByKey,
  getMemoryWithEmbeddingByKey,
  listActiveMemories,
  listMemories,
  listMemoryEmbeddings,
  searchMemoryEntries,
  updateMemoryByKey,
  type MemoryEntry,
} from '../db/repositories/long-term-memory';
import { runInDatabaseTransaction } from '../db/transaction';
import { createMemorySource } from '../db/repositories/memory-sources';
import { embedText } from '../rag/embedding';
import { serializeEmbedding } from '../rag/vector';
import { deserializeEmbedding, topKBySimilarity } from '../rag/vector';
import { isDuplicateMemory, isSemanticallyDuplicateMemory } from './dedupe';
import { queueMemoryReembed } from './reembed-queue';
import type {
  MemoryModelUsePolicy,
  MemorySensitivity,
  PersonalMemoryType,
} from '../shared/types';
import {
  rejectMemoryByUser,
  replaceMemoryFromUserEdit,
} from './personal-memory-service';

export { getMemoryByKey, listMemories, type MemoryEntry };

export const MANAGED_MEMORY_MAX_CONTENT_LENGTH = 2000;
export const MANAGED_MEMORY_LIST_LIMIT = 200;

function lexicalRelevance(query: string, memory: MemoryEntry): number {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return 0;
  const haystack = `${memory.memoryKey ?? ''} ${memory.content}`.toLocaleLowerCase();
  if (haystack.includes(normalizedQuery)) return 1;
  const terms = normalizedQuery.split(/[\s,，。！？、;；:：]+/).filter(Boolean);
  if (!terms.length) return 0;
  return terms.filter((term) => haystack.includes(term)).length / terms.length;
}

function rankMemories(
  query: string,
  candidates: Array<{ memory: MemoryEntry; semantic?: number }>,
  limit: number,
): MemoryEntry[] {
  const now = Date.now();
  return candidates
    .map(({ memory, semantic }) => {
      const ageDays = Math.max(0, now - memory.updatedAt) / 86_400_000;
      const freshness = 1 / (1 + ageDays / 90);
      const relevance = semantic ?? lexicalRelevance(query, memory);
      return {
        memory,
        score: relevance * 0.5 + memory.importance * 0.2 + memory.confidence * 0.2 + freshness * 0.1,
      };
    })
    .sort((a, b) => b.score - a.score || b.memory.updatedAt - a.memory.updatedAt)
    .slice(0, Math.max(1, Math.min(20, limit)))
    .map(({ memory }) => memory);
}

export function searchMemories(query: string, limit = 5): MemoryEntry[] {
  return rankMemories(
    query,
    searchMemoryEntries(query, 50).map((memory) => ({ memory })),
    limit,
  );
}

/** LIKE 无结果时用语义向量检索补充 */
export async function searchMemoriesWithEmbedding(
  query: string,
  limit = 5,
  signal?: AbortSignal,
): Promise<MemoryEntry[]> {
  const likeHits = searchMemories(query, limit);

  const stored = listMemoryEmbeddings(500);
  const withVec = stored.filter((s) => s.embedding);
  if (!withVec.length) return likeHits;

  try {
    const queryVec = new Float32Array(await embedText(query.trim(), signal));
    const hits = topKBySimilarity(
      queryVec,
      withVec.map((s) => ({
        data: s,
        embedding: deserializeEmbedding(s.embedding!),
      })),
      limit,
    ).filter((h) => h.score >= 0.5);

    if (!hits.length) return likeHits;

    const combined = new Map<string, { memory: MemoryEntry; semantic?: number }>();
    for (const memory of likeHits) combined.set(memory.id, { memory });
    for (const hit of hits) combined.set(hit.item.id, { memory: hit.item, semantic: hit.score });
    return rankMemories(query, [...combined.values()], limit);
  } catch (err) {
    if (signal?.aborted) throw err;
    console.warn('[memory] 向量检索失败，回退 LIKE:', err);
    return likeHits;
  }
}

async function computeEmbeddingBlob(
  content: string,
  skipEmbedding?: boolean,
): Promise<Uint8Array | null> {
  if (skipEmbedding) return null;
  try {
    const vec = await embedText(content);
    return serializeEmbedding(vec);
  } catch (err) {
    console.warn('[memory] embedding 失败，跳过向量写入:', err);
    return null;
  }
}

/**
 * 按 memory_key 更新或插入——结构化记忆的唯一定稿入口。
 * 同一 key 永远只有一条记录。
 */
export async function upsertMemory(
  memoryKey: string,
  content: string,
  importance = 0.5,
  sessionId?: string,
  options?: {
    skipEmbedding?: boolean;
    memoryType?: PersonalMemoryType;
    confidence?: number;
    sensitivity?: MemorySensitivity;
    modelUsePolicy?: MemoryModelUsePolicy;
    validFrom?: number;
    expiresAt?: number | null;
    sourceMessageId?: string | null;
    sourceRunId?: string | null;
  },
): Promise<MemoryEntry> {
  const key = memoryKey.trim();
  const trimmed = content.trim();
  if (!key || !trimmed) {
    throw new Error('memory_key 与 content 不能为空');
  }

  const clampedImportance = Math.max(0, Math.min(1, importance));
  const now = Date.now();
  const existing = getMemoryWithEmbeddingByKey(key);
  const embeddingBlob = await computeEmbeddingBlob(trimmed, options?.skipEmbedding);

  if (existing) {
    const contentChanged = existing.content !== trimmed;
    if (contentChanged) {
      throw new Error(`同一主题已有不同事实，请先走冲突确认: ${key}`);
    }
    let embeddingToWrite: Uint8Array | null;

    if (options?.skipEmbedding) {
      embeddingToWrite = existing.embedding;
    } else {
      embeddingToWrite = embeddingBlob ?? existing.embedding;
    }

    const updated = runInDatabaseTransaction((db) => {
      const result = updateMemoryByKey(key, {
        content: trimmed,
        importance: clampedImportance,
        sourceSessionId: sessionId,
        updatedAt: now,
        memoryType: options?.memoryType,
        confidence: options?.confidence,
        sensitivity: options?.sensitivity,
        modelUsePolicy: options?.modelUsePolicy,
        validFrom: options?.validFrom,
        expiresAt: options?.expiresAt,
        embedding: embeddingToWrite,
      }, db);
      if (!result) throw new Error(`长期记忆在更新前消失: ${key}`);
      createMemorySource({
        memoryId: result.id,
        sourceType: 'conversation',
        sourceSessionId: sessionId ?? null,
        sourceMessageId: options?.sourceMessageId ?? null,
        sourceRunId: options?.sourceRunId ?? null,
        sourceRef: options?.sourceMessageId
          ? `conversation:${sessionId ?? 'unknown'}:${options.sourceMessageId}`
          : sessionId ? `conversation:${sessionId}` : null,
        summary: '重复来源确认',
        createdAt: now,
      }, db);
      return result;
    });

    return updated;
  }

  const created = runInDatabaseTransaction((db) => {
    const result = createMemory({
      memoryKey: key,
      content: trimmed,
      importance: clampedImportance,
      sourceSessionId: sessionId,
      createdAt: now,
      updatedAt: now,
      memoryType: options?.memoryType,
      confidence: options?.confidence,
      sensitivity: options?.sensitivity,
      modelUsePolicy: options?.modelUsePolicy,
      validFrom: options?.validFrom,
      expiresAt: options?.expiresAt,
      embedding: embeddingBlob,
    }, db);
    createMemorySource({
      memoryId: result.id,
      sourceType: 'conversation',
      sourceSessionId: sessionId ?? null,
      sourceMessageId: options?.sourceMessageId ?? null,
      sourceRunId: options?.sourceRunId ?? null,
      sourceRef: options?.sourceMessageId
        ? `conversation:${sessionId ?? 'unknown'}:${options.sourceMessageId}`
        : sessionId ? `conversation:${sessionId}` : null,
      summary: '长期记忆首次写入',
      createdAt: now,
    }, db);
    return result;
  });

  if (options?.skipEmbedding) {
    queueMemoryReembed(key, trimmed);
  }

  return created;
}

/** 无 key 的自由文本写入（仅 save_memory 工具等场景）；自动提取仅对已确认或静默通过的候选调用 upsertMemory */
export async function saveMemory(
  content: string,
  importance = 0.5,
  sessionId?: string,
  options?: { skipDedupe?: boolean; skipEmbedding?: boolean },
): Promise<MemoryEntry | null> {
  const trimmed = content.trim();
  if (!trimmed) return null;

  if (!options?.skipDedupe && isDuplicateMemory(trimmed, listMemoryContents())) {
    return null;
  }

  let embeddingBlob: Uint8Array | null = null;
  if (!options?.skipEmbedding) {
    try {
      const vec = await embedText(trimmed);
      embeddingBlob = serializeEmbedding(vec);
      const queryVec = new Float32Array(vec);
      if (
        !options?.skipDedupe &&
        isSemanticallyDuplicateMemory(queryVec, listMemoryEmbeddings())
      ) {
        return null;
      }
    } catch (err) {
      console.warn('[memory] embedding 失败，仅使用文本去重:', err);
      if (!options?.skipDedupe && isDuplicateMemory(trimmed, listMemoryContents())) {
        return null;
      }
    }
  }

  const now = Date.now();
  const clampedImportance = Math.max(0, Math.min(1, importance));

  const created = runInDatabaseTransaction((db) => {
    const result = createMemory({
      content: trimmed,
      importance: clampedImportance,
      sourceSessionId: sessionId ?? null,
      createdAt: now,
      embedding: embeddingBlob,
    }, db);
    createMemorySource({
      memoryId: result.id,
      sourceType: 'conversation',
      sourceSessionId: sessionId ?? null,
      sourceRef: sessionId ? `conversation:${sessionId}` : null,
      summary: '自由文本长期记忆写入',
      createdAt: now,
    }, db);
    return result;
  });
  return created;
}

export function formatMemoriesForPrompt(memories: MemoryEntry[]): string | null {
  const now = Date.now();
  const eligible = memories.filter((memory) =>
    memory.status === 'active' &&
    memory.modelUsePolicy === 'allow' &&
    (memory.expiresAt == null || memory.expiresAt > now));
  if (!eligible.length) return null;
  const escape = (value: string) => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const lines = eligible.map((m) => {
    const key = m.memoryKey ? ` key="${escape(m.memoryKey)}"` : '';
    return `<memory ref="mem:${escape(m.id)}" type="${m.memoryType}"${key}>${escape(m.content)}</memory>`;
  });
  return `【长期记忆】\n以下是可用于回答的已确认记忆。使用其中事实时，请在相关句末附上对应 ref（例如 〔mem:…〕）。\n${lines.join('\n')}`;
}

export function formatMemoriesForExtraction(memories: MemoryEntry[]): string {
  if (!memories.length) return '（暂无）';
  return memories
    .map((m) => (m.memoryKey ? `- ${m.memoryKey}: ${m.content}` : `- ${m.content}`))
    .join('\n');
}

export function listMemoryContents(): string[] {
  return listMemories(200).map((m) => m.content);
}

export function listManagedMemories(limit = MANAGED_MEMORY_LIST_LIMIT): MemoryEntry[] {
  return listActiveMemories(Math.max(1, Math.min(500, limit)));
}

export function getManagedMemory(id: string): MemoryEntry | null {
  return getMemoryById(id) ?? null;
}

export async function updateManagedMemory(id: string, content: string): Promise<MemoryEntry> {
  const trimmed = content.trim();
  if (!trimmed) throw new Error('记忆内容不能为空');
  if (trimmed.length > MANAGED_MEMORY_MAX_CONTENT_LENGTH) {
    throw new Error(`记忆内容不能超过 ${MANAGED_MEMORY_MAX_CONTENT_LENGTH} 字`);
  }

  const existing = getMemoryById(id);
  if (!existing) throw new Error('长期记忆不存在');
  if (existing.content === trimmed) return existing;

  const updated = replaceMemoryFromUserEdit(existing, trimmed);

  // deny 策略的记忆不会被检索使用，也不能把内容发给远端 embedding 服务。
  if (updated.memoryKey && updated.modelUsePolicy === 'allow') {
    queueMemoryReembed(updated.memoryKey, trimmed);
  }

  return updated;
}

export function deleteManagedMemory(id: string): MemoryEntry {
  return rejectMemoryByUser(id);
}
