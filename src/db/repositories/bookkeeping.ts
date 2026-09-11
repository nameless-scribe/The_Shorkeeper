import { v4 as uuidv4 } from 'uuid';
import { getDatabase, type AppDatabase } from '../index';

export type BookkeepingEntryType = 'income' | 'expense';

export interface BookkeepingEntry {
  id: string;
  sessionId: string | null;
  category: string;
  amount: number;
  currency: string;
  note: string | null;
  entryType: BookkeepingEntryType;
  createdAt: number;
}

interface BookkeepingRow {
  id: string;
  session_id: string | null;
  category: string;
  amount: number;
  currency: string;
  note: string | null;
  entry_type: string;
  created_at: number;
}

function rowToEntry(row: BookkeepingRow): BookkeepingEntry {
  return {
    id: row.id,
    sessionId: row.session_id,
    category: row.category,
    amount: Number(row.amount),
    currency: row.currency,
    note: row.note,
    entryType: row.entry_type as BookkeepingEntryType,
    createdAt: Number(row.created_at),
  };
}

export function createBookkeepingEntry(
  input: {
    sessionId?: string | null;
    category: string;
    amount: number;
    currency?: string;
    note?: string | null;
    entryType: BookkeepingEntryType;
  },
  db: AppDatabase = getDatabase(),
): BookkeepingEntry {
  const entry: BookkeepingEntry = {
    id: uuidv4(),
    sessionId: input.sessionId ?? null,
    category: input.category.trim() || '未分类',
    amount: input.amount,
    currency: input.currency ?? 'CNY',
    note: input.note?.trim() || null,
    entryType: input.entryType,
    createdAt: Date.now(),
  };
  db.prepare(
    `INSERT INTO bookkeeping_entries
       (id, session_id, category, amount, currency, note, entry_type, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.id,
    entry.sessionId,
    entry.category,
    entry.amount,
    entry.currency,
    entry.note,
    entry.entryType,
    entry.createdAt,
  );
  return entry;
}

export function listBookkeepingEntries(
  limit = 50,
  db: AppDatabase = getDatabase(),
): BookkeepingEntry[] {
  const rows = db
    .prepare(
      `SELECT id, session_id, category, amount, currency, note, entry_type, created_at
       FROM bookkeeping_entries
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(Math.max(1, Math.min(limit, 500))) as unknown as BookkeepingRow[];
  return rows.map(rowToEntry);
}
