/**
 * P6.2 ask_user 提问账本。
 * 只在这里写 SQL；`src/agent/user-questions.ts` 在有数据库时先建 pending 记录，拿到结果后收口。
 */
import { v4 as uuidv4 } from 'uuid';
import { getDatabase, type AppDatabase } from '../index';
import type { UserQuestionRow } from '../schema';
import type { UserQuestionOption } from '../../shared/types';

export type UserQuestionStatus = 'pending' | 'answered' | 'expired' | 'cancelled' | 'interrupted';
export type UserQuestionDecidedBy = 'user' | 'timeout' | 'abort' | 'window_closed' | 'startup';

export interface UserQuestionInfo {
  id: string;
  runId: string | null;
  sessionId: string | null;
  question: string;
  why: string | null;
  options: UserQuestionOption[];
  allowFreeText: boolean;
  answer: string | null;
  optionId: string | null;
  status: UserQuestionStatus;
  decidedBy: UserQuestionDecidedBy | null;
  askedAt: number;
  answeredAt: number | null;
}

export interface CreateUserQuestionInput {
  id?: string;
  runId?: string | null;
  sessionId?: string | null;
  question: string;
  why?: string | null;
  options?: UserQuestionOption[];
  allowFreeText?: boolean;
  askedAt?: number;
}

const QUESTION_MAX = 300;
const WHY_MAX = 120;
const ANSWER_MAX = 4_000;

function clip(value: string, max: number): string {
  const chars = [...value];
  return chars.length <= max ? value : `${chars.slice(0, max).join('')}…`;
}

function parseOptions(raw: string): UserQuestionOption[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is UserQuestionOption =>
        !!item && typeof item === 'object' && typeof (item as UserQuestionOption).id === 'string'
        && typeof (item as UserQuestionOption).label === 'string')
      .map((item) => (item.hint ? { id: item.id, label: item.label, hint: item.hint } : { id: item.id, label: item.label }));
  } catch {
    return [];
  }
}

function rowToInfo(row: UserQuestionRow): UserQuestionInfo {
  return {
    id: row.id,
    runId: row.run_id,
    sessionId: row.session_id,
    question: row.question,
    why: row.why,
    options: parseOptions(row.options_json),
    allowFreeText: row.allow_free_text === 1,
    answer: row.answer,
    optionId: row.option_id,
    status: row.status as UserQuestionStatus,
    decidedBy: row.decided_by as UserQuestionDecidedBy | null,
    askedAt: row.asked_at,
    answeredAt: row.answered_at,
  };
}

export function getUserQuestion(id: string, db: AppDatabase = getDatabase()): UserQuestionInfo | null {
  const row = db.prepare('SELECT * FROM user_questions WHERE id = ?').get(id) as UserQuestionRow | undefined;
  return row ? rowToInfo(row) : null;
}

export function createUserQuestion(
  input: CreateUserQuestionInput,
  db: AppDatabase = getDatabase(),
): UserQuestionInfo {
  const id = input.id ?? uuidv4();
  const askedAt = input.askedAt ?? Date.now();
  db.prepare(
    `INSERT INTO user_questions
       (id, run_id, session_id, question, why, options_json, allow_free_text, status, asked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
  ).run(
    id,
    input.runId ?? null,
    input.sessionId ?? null,
    clip(input.question, QUESTION_MAX),
    input.why ? clip(input.why, WHY_MAX) : null,
    JSON.stringify(input.options ?? []),
    input.allowFreeText === false ? 0 : 1,
    askedAt,
  );
  return getUserQuestion(id, db)!;
}

export interface AnswerUserQuestionInput {
  answer?: string;
  optionId?: string;
  decidedBy: UserQuestionDecidedBy;
  answeredAt?: number;
}

/** 由决定方式推出状态：用户回答 → answered，超时 → expired，取消 / 窗口关闭 → cancelled，启动收口 → interrupted */
export function statusForDecision(decidedBy: UserQuestionDecidedBy): Exclude<UserQuestionStatus, 'pending'> {
  if (decidedBy === 'user') return 'answered';
  if (decidedBy === 'timeout') return 'expired';
  if (decidedBy === 'startup') return 'interrupted';
  return 'cancelled';
}

/** 只收口 pending 记录；重复收口不覆盖已有结论。 */
export function answerUserQuestion(
  id: string,
  input: AnswerUserQuestionInput,
  db: AppDatabase = getDatabase(),
): UserQuestionInfo | null {
  db.prepare(
    `UPDATE user_questions
     SET status = ?, decided_by = ?, answer = ?, option_id = ?, answered_at = ?
     WHERE id = ? AND status = 'pending'`,
  ).run(
    statusForDecision(input.decidedBy),
    input.decidedBy,
    input.answer != null ? clip(input.answer, ANSWER_MAX) : null,
    input.optionId ?? null,
    input.answeredAt ?? Date.now(),
    id,
  );
  return getUserQuestion(id, db);
}

export function listUserQuestions(runId: string, db: AppDatabase = getDatabase()): UserQuestionInfo[] {
  const rows = db
    .prepare('SELECT * FROM user_questions WHERE run_id = ? ORDER BY asked_at ASC')
    .all(runId) as unknown as UserQuestionRow[];
  return rows.map(rowToInfo);
}

/** 启动收口：进程退出时还在等回答的问题一律标为 interrupted。返回条数。 */
export function markInterruptedUserQuestions(now = Date.now(), db: AppDatabase = getDatabase()): number {
  const pending = db
    .prepare(`SELECT COUNT(*) AS count FROM user_questions WHERE status = 'pending'`)
    .get() as { count: number } | undefined;
  db.prepare(
    `UPDATE user_questions SET status = 'interrupted', decided_by = 'startup', answered_at = ?
     WHERE status = 'pending'`,
  ).run(now);
  return Number(pending?.count ?? 0);
}

/** 某次运行最后一条被中断的问题（下一轮对话要带上它）。 */
export function findInterruptedQuestion(runId: string, db: AppDatabase = getDatabase()): UserQuestionInfo | null {
  const row = db
    .prepare(
      `SELECT * FROM user_questions WHERE run_id = ? AND status = 'interrupted'
       ORDER BY asked_at DESC LIMIT 1`,
    )
    .get(runId) as UserQuestionRow | undefined;
  return row ? rowToInfo(row) : null;
}
