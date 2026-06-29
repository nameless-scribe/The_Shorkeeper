import { v4 as uuid } from 'uuid';
import { getDatabase } from './index';
import type { TokenUsageRow } from './schema';

export interface TokenUsageRecord {
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
  sessionId?: string;
  model: string;
}

export interface TokenUsageSummary {
  today: number;
  week: number;
  total: number;
  todayCached: number;
  cacheHitRateToday: number;
  dailyLast7: { date: string; tokens: number }[];
}

function startOfDay(ts = Date.now()): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfWeek(ts = Date.now()): number {
  const d = new Date(ts);
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function recordTokenUsage(input: TokenUsageRecord): void {
  getDatabase()
    .prepare(
      `INSERT INTO token_usage (id, session_id, model, prompt_tokens, completion_tokens, cached_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      uuid(),
      input.sessionId ?? null,
      input.model,
      input.promptTokens,
      input.completionTokens,
      input.cachedTokens ?? 0,
      Date.now(),
    );
}

function readTotal(row: { total: number } | undefined): number {
  return Number(row?.total ?? 0);
}

function sumTokensSince(since: number): number {
  const row = getDatabase()
    .prepare(
      `SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS total
       FROM token_usage WHERE created_at >= ?`,
    )
    .get(since) as { total: number } | undefined;
  return readTotal(row);
}

function sumCachedSince(since: number): number {
  const row = getDatabase()
    .prepare(
      `SELECT COALESCE(SUM(cached_tokens), 0) AS total
       FROM token_usage WHERE created_at >= ?`,
    )
    .get(since) as { total: number } | undefined;
  return readTotal(row);
}

function sumPromptSince(since: number): number {
  const row = getDatabase()
    .prepare(
      `SELECT COALESCE(SUM(prompt_tokens), 0) AS total
       FROM token_usage WHERE created_at >= ?`,
    )
    .get(since) as { total: number } | undefined;
  return readTotal(row);
}

export function getTokenUsageSummary(): TokenUsageSummary {
  const now = Date.now();
  const todayStart = startOfDay(now);
  const weekStart = startOfWeek(now);

  const totalRow = getDatabase()
    .prepare(
      `SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS total FROM token_usage`,
    )
    .get() as { total: number } | undefined;

  const dailyLast7: { date: string; tokens: number }[] = [];
  for (let i = 6; i >= 0; i -= 1) {
    const dayStart = startOfDay(now - i * 86_400_000);
    const dayEnd = dayStart + 86_400_000;
    const row = getDatabase()
      .prepare(
        `SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS total
         FROM token_usage WHERE created_at >= ? AND created_at < ?`,
      )
      .get(dayStart, dayEnd) as { total: number } | undefined;
    dailyLast7.push({ date: formatDate(dayStart), tokens: readTotal(row) });
  }

  const todayCached = sumCachedSince(todayStart);
  const todayPrompt = sumPromptSince(todayStart);
  const cacheHitRateToday =
    todayPrompt > 0 ? Math.round((todayCached / todayPrompt) * 100) : 0;

  return {
    today: sumTokensSince(todayStart),
    week: sumTokensSince(weekStart),
    total: readTotal(totalRow),
    todayCached,
    cacheHitRateToday,
    dailyLast7,
  };
}

export function getTodayTokenCount(): number {
  return sumTokensSince(startOfDay());
}

export function listRecentUsage(limit = 20): TokenUsageRow[] {
  return getDatabase()
    .prepare(
      `SELECT id, session_id, model, prompt_tokens, completion_tokens,
              COALESCE(cached_tokens, 0) AS cached_tokens, created_at
       FROM token_usage ORDER BY created_at DESC LIMIT ?`,
    )
    .all(limit) as unknown as TokenUsageRow[];
}
