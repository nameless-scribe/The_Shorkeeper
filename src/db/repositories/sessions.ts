import { v4 as uuid } from 'uuid';
import { getDatabase, type AppDatabase } from '../index';

export interface Session {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export function createSession(db: AppDatabase = getDatabase(), title = '新对话'): Session {
  const now = Date.now();
  const session: Session = {
    id: uuid(),
    title,
    createdAt: now,
    updatedAt: now,
  };
  db.prepare(
    `INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`,
  ).run(session.id, session.title, session.createdAt, session.updatedAt);
  return session;
}

export function getSession(id: string, db: AppDatabase = getDatabase()): Session | null {
  const row = db
    .prepare(`SELECT id, title, created_at, updated_at FROM sessions WHERE id = ?`)
    .get(id);
  if (!row) return null;
  return {
    id: String(row.id),
    title: String(row.title),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export function listSessions(db: AppDatabase = getDatabase()): Session[] {
  const rows = db
    .prepare(`SELECT id, title, created_at, updated_at FROM sessions ORDER BY updated_at DESC`)
    .all();
  return rows.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }));
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

export function getOrCreateDefaultSession(db: AppDatabase = getDatabase()): Session {
  const sessions = listSessions(db);
  if (sessions.length > 0) return sessions[0];
  return createSession(db);
}
