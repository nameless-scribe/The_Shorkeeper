import { getSetting, setSetting } from '../db/app-settings';
import {
  DEFAULT_AFFECTION_SCORE,
  MAX_AFFECTION_SCORE,
  getStageForScore,
  type AffectionStage,
} from './stages';

export {
  AFFECTION_STAGES,
  DEFAULT_AFFECTION_SCORE,
  MAX_AFFECTION_SCORE,
  getStageForScore,
  type AffectionStage,
} from './stages';

const KEYS = {
  score: 'affection.score',
  chatDay: 'affection.chat_day',
  chatTurnBonus: 'affection.chat_turn_bonus',
  feedDay: 'affection.feed_day',
} as const;

const DAILY_FIRST_BONUS = 2;
const DAILY_TURN_BONUS = 1;
const DAILY_TURN_BONUS_CAP = 5;
const FEED_BONUS = 3;

function localDateKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseScore(raw: string | null): number | null {
  if (raw == null || raw.trim() === '') return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function readScore(): number {
  const stored = parseScore(getSetting(KEYS.score));
  if (stored != null) return Math.min(MAX_AFFECTION_SCORE, Math.max(0, stored));
  setSetting(KEYS.score, String(DEFAULT_AFFECTION_SCORE));
  return DEFAULT_AFFECTION_SCORE;
}

function writeScore(score: number): number {
  const clamped = Math.min(MAX_AFFECTION_SCORE, Math.max(0, score));
  setSetting(KEYS.score, String(clamped));
  return clamped;
}

function addScore(delta: number): { score: number; stage: AffectionStage; stageChanged: boolean } {
  if (delta <= 0) {
    const score = readScore();
    return { score, stage: getStageForScore(score), stageChanged: false };
  }

  const before = readScore();
  const beforeStage = getStageForScore(before);
  const after = writeScore(before + delta);
  const afterStage = getStageForScore(after);
  return {
    score: after,
    stage: afterStage,
    stageChanged: beforeStage.id !== afterStage.id,
  };
}

export function getAffectionScore(): number {
  return readScore();
}

export function getAffectionStage(): AffectionStage {
  return getStageForScore(readScore());
}

export function getAffectionStageLabel(): string {
  return getAffectionStage().label;
}

/** 完成一轮对话后结算（只升不降） */
export function recordChatAffection(now = new Date()): {
  delta: number;
  stageChanged: boolean;
} {
  const today = localDateKey(now);
  const storedDay = getSetting(KEYS.chatDay);
  let turnBonus =
    storedDay === today ? Number.parseInt(getSetting(KEYS.chatTurnBonus) ?? '0', 10) : 0;
  if (!Number.isFinite(turnBonus) || turnBonus < 0) turnBonus = 0;

  let delta = 0;

  if (storedDay !== today) {
    delta += DAILY_FIRST_BONUS;
    turnBonus = 0;
  }

  if (turnBonus < DAILY_TURN_BONUS_CAP) {
    delta += DAILY_TURN_BONUS;
    turnBonus += 1;
  }

  setSetting(KEYS.chatDay, today);
  setSetting(KEYS.chatTurnBonus, String(turnBonus));

  const result = addScore(delta);
  return { delta, stageChanged: result.stageChanged };
}

/** 喂食后结算（每天最多一次，只升不降） */
export function recordFeedAffection(now = new Date()): {
  delta: number;
  stageChanged: boolean;
} {
  const today = localDateKey(now);
  if (getSetting(KEYS.feedDay) === today) {
    return { delta: 0, stageChanged: false };
  }

  setSetting(KEYS.feedDay, today);
  const result = addScore(FEED_BONUS);
  return { delta: FEED_BONUS, stageChanged: result.stageChanged };
}

/** 注入 system prompt 的动态片段 */
export function formatAffectionForPrompt(): string {
  const stage = getAffectionStage();
  return `【当前羁绊】
阶段：${stage.label}
表现：${stage.promptGuide}`;
}
