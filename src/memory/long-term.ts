import {
  createMemory,
  deleteMemoryById,
  getMemoryById,
  getMemoryByKey,
  getMemoryWithEmbeddingByKey,
  listMemories,
  listMemoryEmbeddings,
  searchMemoryEntries,
  updateMemoryByKey,
  updateMemoryContentById,
  type MemoryEntry,
} from '../db/repositories/long-term-memory';
import { rejectMemoryFact } from '../db/repositories/memory-candidates';
import { classifyMemoryKey } from './candidate-policy';
import { embedText } from '../rag/embedding';
import { serializeEmbedding } from '../rag/vector';
import { deserializeEmbedding, topKBySimilarity } from '../rag/vector';
import { isDuplicateMemory, isSemanticallyDuplicateMemory } from './dedupe';
import { queueMemoryReembed } from './reembed-queue';

export { getMemoryByKey, listMemories, type MemoryEntry };

export const MANAGED_MEMORY_MAX_CONTENT_LENGTH = 2000;
export const MANAGED_MEMORY_LIST_LIMIT = 200;

export function searchMemories(query: string, limit = 5): MemoryEntry[] {
  return searchMemoryEntries(query, limit);
}

/** LIKE 无结果时用语义向量检索补充 */
export async function searchMemoriesWithEmbedding(
  query: string,
  limit = 5,
  signal?: AbortSignal,
): Promise<MemoryEntry[]> {
  const likeHits = searchMemories(query, limit);
  if (likeHits.length) return likeHits;

  const stored = listMemoryEmbeddings(500);
  const withVec = stored.filter((s) => s.embedding);
  if (!withVec.length) return [];

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

    if (!hits.length) return [];

    return hits.map((hit) => hit.item);
  } catch (err) {
    if (signal?.aborted) throw err;
    console.warn('[memory] 向量检索失败，回退 LIKE:', err);
    return [];
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
  options?: { skipEmbedding?: boolean },
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
    let embeddingToWrite: Uint8Array | null;

    if (options?.skipEmbedding) {
      if (contentChanged) {
        embeddingToWrite = null;
      } else {
        embeddingToWrite = existing.embedding;
      }
    } else {
      embeddingToWrite = embeddingBlob ?? existing.embedding;
    }

    const updated = updateMemoryByKey(key, {
      content: trimmed,
      importance: clampedImportance,
      sourceSessionId: sessionId,
      createdAt: now,
      embedding: embeddingToWrite,
    });
    if (!updated) {
      throw new Error(`长期记忆在更新前消失: ${key}`);
    }

    if (options?.skipEmbedding && contentChanged) {
      queueMemoryReembed(key, trimmed);
    }

    return updated;
  }

  const created = createMemory({
    memoryKey: key,
    content: trimmed,
    importance: clampedImportance,
    sourceSessionId: sessionId,
    createdAt: now,
    embedding: embeddingBlob,
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

  return createMemory({
    content: trimmed,
    importance: clampedImportance,
    sourceSessionId: sessionId ?? null,
    createdAt: now,
    embedding: embeddingBlob,
  });
}

export function formatMemoriesForPrompt(memories: MemoryEntry[]): string | null {
  if (!memories.length) return null;
  const lines = memories.map((m) =>
    m.memoryKey ? `- [${m.memoryKey}] ${m.content}` : `- ${m.content}`,
  );
  return `【长期记忆】\n${lines.join('\n')}`;
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
  return listMemories(Math.max(1, Math.min(500, limit)));
}

function rejectManagedMemoryFact(
  memoryKey: string | null,
  content: string,
  reason: string,
): void {
  if (!memoryKey) return;
  rejectMemoryFact({
    memoryKey,
    content,
    category: classifyMemoryKey(memoryKey) ?? 'other',
    confidence: 1,
    reason,
  });
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

  const updated = updateMemoryContentById(id, trimmed, null);
  if (!updated) throw new Error('长期记忆在更新后消失');

  rejectManagedMemoryFact(existing.memoryKey, existing.content, '用户从设置中修改');

  if (updated.memoryKey) {
    queueMemoryReembed(updated.memoryKey, trimmed);
  }

  return updated;
}

export function deleteManagedMemory(id: string): MemoryEntry {
  const deleted = deleteMemoryById(id);
  if (!deleted) throw new Error('长期记忆不存在');

  rejectManagedMemoryFact(deleted.memoryKey, deleted.content, '用户从设置中删除');
  return deleted;
}
