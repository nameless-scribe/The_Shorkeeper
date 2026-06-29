import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db';

export interface MemoryEntry {
  id: string;
  content: string;
  importance: number;
  sourceSessionId: string | null;
  createdAt: number;
}

function rowToEntry(row: {
  id: string;
  content: string;
  importance: number;
  source_session_id: string | null;
  created_at: number;
}): MemoryEntry {
  return {
    id: row.id,
    content: row.content,
    importance: row.importance,
    sourceSessionId: row.source_session_id,
    createdAt: row.created_at,
  };
}

export function listMemories(limit = 50): MemoryEntry[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT id, content, importance, source_session_id, created_at
       FROM long_term_memory
       ORDER BY importance DESC, created_at DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{
    id: string;
    content: string;
    importance: number;
    source_session_id: string | null;
    created_at: number;
  }>;

  return rows.map(rowToEntry);
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
      `SELECT id, content, importance, source_session_id, created_at
       FROM long_term_memory
       WHERE content LIKE ?
       ORDER BY importance DESC, created_at DESC
       LIMIT ?`,
    )
    .all(pattern, limit) as Array<{
    id: string;
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

export function saveMemory(
  content: string,
  importance = 0.5,
  sessionId?: string,
): MemoryEntry {
  const db = getDatabase();
  const id = uuidv4();
  const now = Date.now();
  const clampedImportance = Math.max(0, Math.min(1, importance));

  db.prepare(
    `INSERT INTO long_term_memory (id, content, importance, source_session_id, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, content.trim(), clampedImportance, sessionId ?? null, now);

  return {
    id,
    content: content.trim(),
    importance: clampedImportance,
    sourceSessionId: sessionId ?? null,
    createdAt: now,
  };
}

export function formatMemoriesForPrompt(memories: MemoryEntry[]): string | null {
  if (!memories.length) return null;
  const lines = memories.map((m) => `- ${m.content}`);
  return `【长期记忆】\n${lines.join('\n')}`;
}

export function listMemoryContents(): string[] {
  return listMemories(200).map((m) => m.content);
}
