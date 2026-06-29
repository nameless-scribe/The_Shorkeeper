import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db';
import { embedText } from '../rag/embedding';
import { serializeEmbedding } from '../rag/vector';
import { isDuplicateMemory, isSemanticallyDuplicateMemory } from './dedupe';

export interface MemoryEntry {
  id: string;
  memoryKey: string | null;
  content: string;
  importance: number;
  sourceSessionId: string | null;
  createdAt: number;
}

function rowToEntry(row: {
  id: string;
  memory_key: string | null;
  content: string;
  importance: number;
  source_session_id: string | null;
  created_at: number;
}): MemoryEntry {
  return {
    id: row.id,
    memoryKey: row.memory_key,
    content: row.content,
    importance: row.importance,
    sourceSessionId: row.source_session_id,
    createdAt: row.created_at,
  };
}

const MEMORY_SELECT = `id, memory_key, content, importance, source_session_id, created_at`;

export function listMemories(limit = 50): MemoryEntry[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT ${MEMORY_SELECT}
       FROM long_term_memory
       ORDER BY importance DESC, created_at DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{
    id: string;
    memory_key: string | null;
    content: string;
    importance: number;
    source_session_id: string | null;
    created_at: number;
  }>;

  return rows.map(rowToEntry);
}

export function getMemoryByKey(memoryKey: string): MemoryEntry | undefined {
  const db = getDatabase();
  const row = db
    .prepare(`SELECT ${MEMORY_SELECT} FROM long_term_memory WHERE memory_key = ?`)
    .get(memoryKey) as
    | {
        id: string;
        memory_key: string | null;
        content: string;
        importance: number;
        source_session_id: string | null;
        created_at: number;
      }
    | undefined;

  return row ? rowToEntry(row) : undefined;
}

export function searchMemories(query: string, limit = 5): MemoryEntry[] {
  const trimmed = query.trim();
  const db = getDatabase();

  if (!trimmed) {
    return listMemories(limit);
  }

  const pattern = `%${trimmed}%`;
  const rows = db
    .prepare(
      `SELECT ${MEMORY_SELECT}
       FROM long_term_memory
       WHERE content LIKE ? OR memory_key LIKE ?
       ORDER BY importance DESC, created_at DESC
       LIMIT ?`,
    )
    .all(pattern, pattern, limit) as Array<{
    id: string;
    memory_key: string | null;
    content: string;
    importance: number;
    source_session_id: string | null;
    created_at: number;
  }>;

  if (rows.length) {
    return rows.map(rowToEntry);
  }

  return listMemories(Math.min(limit, 3));
}

function listMemoryEmbeddings(limit = 200): Array<{
  content: string;
  embedding: Uint8Array | null;
}> {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT content, embedding FROM long_term_memory ORDER BY created_at DESC LIMIT ?`,
    )
    .all(limit) as Array<{ content: string; embedding: Uint8Array | null }>;

  return rows;
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

  const db = getDatabase();
  const clampedImportance = Math.max(0, Math.min(1, importance));
  const now = Date.now();
  const existing = getMemoryByKey(key);
  const embeddingBlob = await computeEmbeddingBlob(trimmed, options?.skipEmbedding);

  if (existing) {
    db.prepare(
      `UPDATE long_term_memory
       SET content = ?, importance = ?, source_session_id = ?, created_at = ?, embedding = ?
       WHERE memory_key = ?`,
    ).run(
      trimmed,
      clampedImportance,
      sessionId ?? null,
      now,
      embeddingBlob,
      key,
    );

    return {
      ...existing,
      content: trimmed,
      importance: clampedImportance,
      sourceSessionId: sessionId ?? null,
      createdAt: now,
    };
  }

  const id = uuidv4();
  db.prepare(
    `INSERT INTO long_term_memory (id, memory_key, content, importance, source_session_id, created_at, embedding)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, key, trimmed, clampedImportance, sessionId ?? null, now, embeddingBlob);

  return {
    id,
    memoryKey: key,
    content: trimmed,
    importance: clampedImportance,
    sourceSessionId: sessionId ?? null,
    createdAt: now,
  };
}

/** 无 key 的自由文本写入（仅 save_memory 工具等场景）；自动提取应优先 upsertMemory */
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

  const db = getDatabase();
  const id = uuidv4();
  const now = Date.now();
  const clampedImportance = Math.max(0, Math.min(1, importance));

  db.prepare(
    `INSERT INTO long_term_memory (id, memory_key, content, importance, source_session_id, created_at, embedding)
     VALUES (?, NULL, ?, ?, ?, ?, ?)`,
  ).run(id, trimmed, clampedImportance, sessionId ?? null, now, embeddingBlob);

  return {
    id,
    memoryKey: null,
    content: trimmed,
    importance: clampedImportance,
    sourceSessionId: sessionId ?? null,
    createdAt: now,
  };
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
