import { v4 as uuid } from 'uuid';
import { getDatabase, type AppDatabase } from '../index';

export interface Session {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  compressed: boolean;
}

function rowToSession(row: {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  archived?: number;
  compressed?: number;
}): Session {
  return {
    id: String(row.id),
    title: String(row.title),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    archived: Number(row.archived ?? 0) === 1,
    compressed: Number(row.compressed ?? 0) === 1,
  };
}

const SESSION_SELECT = `id, title, created_at, updated_at,
  COALESCE(archived, 0) AS archived, COALESCE(compressed, 0) AS compressed`;

export function createSession(db: AppDatabase = getDatabase(), title = '新对话'): Session {
  const now = Date.now();
  const session: Session = {
    id: uuid(),
    title,
    createdAt: now,
    updatedAt: now,
    archived: false,
    compressed: false,
  };
  db.prepare(
    `INSERT INTO sessions (id, title, created_at, updated_at, archived, compressed)
     VALUES (?, ?, ?, ?, 0, 0)`,
  ).run(session.id, session.title, session.createdAt, session.updatedAt);
  return session;
}

export function getSession(id: string, db: AppDatabase = getDatabase()): Session | null {
  const row = db
    .prepare(`SELECT ${SESSION_SELECT} FROM sessions WHERE id = ?`)
    .get(id);
  if (!row) return null;
  return rowToSession(row as Parameters<typeof rowToSession>[0]);
}

export function listSessions(
  options?: { includeArchived?: boolean; query?: string },
  db: AppDatabase = getDatabase(),
): Session[] {
  const includeArchived = options?.includeArchived ?? false;
  const query = options?.query?.trim();

  let sql = `SELECT ${SESSION_SELECT} FROM sessions WHERE 1=1`;
  const params: unknown[] = [];

  if (!includeArchived) {
    sql += ` AND COALESCE(archived, 0) = 0`;
  }

  if (query) {
    sql += ` AND title LIKE ?`;
    params.push(`%${query}%`);
  }

  sql += ` ORDER BY updated_at DESC`;

  const rows = db.prepare(sql).all(...params);
  return rows.map((row) => rowToSession(row as Parameters<typeof rowToSession>[0]));
}

export function touchSession(id: string, db: AppDatabase = getDatabase()): void {
  db.prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`).run(Date.now(), id);
}

export function updateSessionTitle(id: string, title: string, db: AppDatabase = getDatabase()): void {
  db.prepare(`UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?`).run(
    title,
    Date.now(),
    id,
  );
}

export function deleteSession(id: string, db: AppDatabase = getDatabase()): void {
  db.prepare(`DELETE FROM messages WHERE session_id = ?`).run(id);
  db.prepare(`DELETE FROM session_summaries WHERE session_id = ?`).run(id);
  db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
}

export function setSessionArchived(id: string, archived: boolean, db: AppDatabase = getDatabase()): void {
  db.prepare(`UPDATE sessions SET archived = ?, updated_at = ? WHERE id = ?`).run(
    archived ? 1 : 0,
    Date.now(),
    id,
  );
}

export function getOrCreateDefaultSession(db: AppDatabase = getDatabase()): Session {
  const sessions = listSessions(undefined, db);
  if (sessions.length > 0) return sessions[0];
  return createSession(db);
}
