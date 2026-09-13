import { v4 as uuidv4 } from 'uuid';
import { getDatabase, type AppDatabase } from '../index';
import type {
  ProactivityFeedbackAction,
  ProactivityFeedbackInfo,
  ProactivityFeedbackReason,
} from '../../shared/types';
import type { ProactivityFeedbackRow } from '../schema';

export const FEEDBACK_ACTIONS = [
  'opened',
  'accepted',
  'dismissed',
  'snoozed',
  'resolved',
] as const satisfies readonly ProactivityFeedbackAction[];

export const FEEDBACK_REASONS = [
  'not_relevant',
  'already_handled',
  'too_noisy',
  'later',
  'source_opened',
  'source_resolved',
  'bulk_clear',
] as const satisfies readonly ProactivityFeedbackReason[];

const ACTIONS: ReadonlySet<string> = new Set(FEEDBACK_ACTIONS);
const REASONS: ReadonlySet<string> = new Set(FEEDBACK_REASONS);

function rowToFeedback(row: ProactivityFeedbackRow): ProactivityFeedbackInfo {
  return {
    id: String(row.id),
    eventId: String(row.event_id),
    action: (ACTIONS.has(String(row.action)) ? String(row.action) : 'opened') as ProactivityFeedbackAction,
    reasonCode: row.reason_code != null && REASONS.has(String(row.reason_code))
      ? (String(row.reason_code) as ProactivityFeedbackReason)
      : null,
    createdAt: Number(row.created_at),
  };
}

const SELECT = `SELECT id, event_id, action, reason_code, created_at FROM proactivity_feedback`;

/** 只记录有限枚举：动作与原因码；绝不保存自由文本。 */
export function recordFeedback(
  input: { eventId: string; action: ProactivityFeedbackAction; reasonCode?: ProactivityFeedbackReason | null; at?: number },
  db: AppDatabase = getDatabase(),
): ProactivityFeedbackInfo {
  if (!ACTIONS.has(input.action)) throw new Error(`不支持的反馈动作: ${input.action}`);
  if (input.reasonCode != null && !REASONS.has(input.reasonCode)) {
    throw new Error(`不支持的反馈原因: ${input.reasonCode}`);
  }
  const id = uuidv4();
  db.prepare(
    `INSERT INTO proactivity_feedback (id, event_id, action, reason_code, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, input.eventId, input.action, input.reasonCode ?? null, input.at ?? Date.now());
  const row = db.prepare(`${SELECT} WHERE id = ?`).get(id) as unknown as ProactivityFeedbackRow;
  return rowToFeedback(row);
}

export function listFeedbackForEvent(eventId: string, db: AppDatabase = getDatabase()): ProactivityFeedbackInfo[] {
  const rows = db
    .prepare(`${SELECT} WHERE event_id = ? ORDER BY created_at ASC`)
    .all(eventId) as unknown as ProactivityFeedbackRow[];
  return rows.map(rowToFeedback);
}

export function countFeedbackByActionSince(
  since: number,
  db: AppDatabase = getDatabase(),
): Record<ProactivityFeedbackAction, number> {
  const rows = db
    .prepare(`SELECT action, COUNT(*) AS count FROM proactivity_feedback WHERE created_at >= ? GROUP BY action`)
    .all(since) as Array<{ action: string; count: number }>;
  const result: Record<ProactivityFeedbackAction, number> = {
    opened: 0,
    accepted: 0,
    dismissed: 0,
    snoozed: 0,
    resolved: 0,
  };
  for (const row of rows) {
    if (ACTIONS.has(row.action)) result[row.action as ProactivityFeedbackAction] = Number(row.count);
  }
  return result;
}
