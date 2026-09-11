import { getDatabase, type AppDatabase } from '../index';

export interface SessionSummary {
  sessionId: string;
  summary: string;
  compressedUpToMessageId: string | null;
  updatedAt: number;
}

export function getSessionSummary(
  sessionId: string,
  db: AppDatabase = getDatabase(),
): SessionSummary | null {
  const row = db
    .prepare(
      `SELECT session_id, summary, compressed_up_to_message_id, updated_at
       FROM session_summaries WHERE session_id = ?`,
    )
    .get(sessionId) as
    | {
        session_id: string;
        summary: string;
        compressed_up_to_message_id: string | null;
        updated_at: number;
      }
    | undefined;

  if (!row) return null;
  return {
    sessionId: row.session_id,
    summary: row.summary,
    compressedUpToMessageId: row.compressed_up_to_message_id,
    updatedAt: row.updated_at,
  };
}

export function upsertSessionSummary(
  sessionId: string,
  summary: string,
  compressedUpToMessageId: string,
  db: AppDatabase = getDatabase(),
): SessionSummary {
  const now = Date.now();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO session_summaries (session_id, summary, compressed_up_to_message_id, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         summary = excluded.summary,
         compressed_up_to_message_id = excluded.compressed_up_to_message_id,
         updated_at = excluded.updated_at`,
    ).run(sessionId, summary, compressedUpToMessageId, now);
    db.prepare('UPDATE sessions SET compressed = 1, updated_at = ? WHERE id = ?').run(
      now,
      sessionId,
    );
  });

  return { sessionId, summary, compressedUpToMessageId, updatedAt: now };
}
