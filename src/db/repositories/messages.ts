import { v4 as uuid } from 'uuid';
import { getDatabase, type AppDatabase } from '../index';
import { touchSession, updateSessionTitle } from './sessions';

export type MessageRole = 'system' | 'user' | 'assistant';

export interface Message {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  tokenCount: number | null;
  createdAt: number;
}

export interface ChatMessage {
  role: MessageRole;
  content: string;
}

export function listMessages(sessionId: string, db: AppDatabase = getDatabase()): Message[] {
  const rows = db
    .prepare(
      `SELECT id, session_id, role, content, token_count, created_at
       FROM messages WHERE session_id = ? ORDER BY created_at ASC`,
    )
    .all(sessionId);

  return rows.map((row) => ({
    id: String(row.id),
    sessionId: String(row.session_id),
    role: row.role as MessageRole,
    content: String(row.content),
    tokenCount: row.token_count == null ? null : Number(row.token_count),
    createdAt: Number(row.created_at),
  }));
}

export function insertMessage(
  sessionId: string,
  role: MessageRole,
  content: string,
  tokenCount: number | null = null,
  db: AppDatabase = getDatabase(),
): Message {
  const message: Message = {
    id: uuid(),
    sessionId,
    role,
    content,
    tokenCount,
    createdAt: Date.now(),
  };

  db.prepare(
    `INSERT INTO messages (id, session_id, role, content, token_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    message.id,
    message.sessionId,
    message.role,
    message.content,
    message.tokenCount,
    message.createdAt,
  );

  touchSession(sessionId, db);

  if (role === 'user') {
    const session = db
      .prepare(`SELECT title FROM sessions WHERE id = ?`)
      .get(sessionId);
    if (session && String(session.title) === '新对话') {
      const title = content.slice(0, 32) + (content.length > 32 ? '…' : '');
      updateSessionTitle(sessionId, title, db);
    }
  }

  return message;
}

export function toChatMessages(messages: Message[]): ChatMessage[] {
  return messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));
}
