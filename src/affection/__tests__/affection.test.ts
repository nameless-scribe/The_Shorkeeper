import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, initDatabase } from '../../db';
import { getSetting } from '../../db/app-settings';
import {
  DEFAULT_AFFECTION_SCORE,
  formatAffectionForPrompt,
  getAffectionScore,
  getAffectionStage,
  recordChatAffection,
  recordFeedAffection,
} from '../index';

let dbPath: string;

beforeEach(async () => {
  dbPath = path.join(os.tmpdir(), `sk-aff-test-${Date.now()}-${Math.random()}.db`);
  await initDatabase(dbPath);
});

afterEach(async () => {
  closeDatabase();
  await fs.unlink(dbPath).catch(() => undefined);
});

describe('affection', () => {
  it('defaults to watching stage score', () => {
    expect(getAffectionScore()).toBe(DEFAULT_AFFECTION_SCORE);
    expect(getAffectionStage().label).toBe('守望');
  });

  it('grants daily first and turn bonuses on chat', () => {
    const day = new Date('2026-07-01T10:00:00');
    const first = recordChatAffection(day);
    expect(first.delta).toBe(3);
    expect(getAffectionScore()).toBe(DEFAULT_AFFECTION_SCORE + 3);

    const second = recordChatAffection(day);
    expect(second.delta).toBe(1);
    expect(getAffectionScore()).toBe(DEFAULT_AFFECTION_SCORE + 4);
  });

  it('caps daily turn bonus at five per day', () => {
    const day = new Date('2026-07-02T10:00:00');
    let totalDelta = 0;
    for (let i = 0; i < 10; i += 1) {
      const { delta } = recordChatAffection(day);
      totalDelta += delta;
    }
    expect(totalDelta).toBe(2 + 5);
  });

  it('resets turn bonus on a new day but keeps score', () => {
    recordChatAffection(new Date('2026-07-03T10:00:00'));
    const scoreBefore = getAffectionScore();
    const nextDay = recordChatAffection(new Date('2026-07-04T10:00:00'));
    expect(nextDay.delta).toBe(3);
    expect(getAffectionScore()).toBe(scoreBefore + 3);
  });

  it('grants feed bonus once per day', () => {
    const day = new Date('2026-07-05T12:00:00');
    const first = recordFeedAffection(day);
    expect(first.delta).toBe(3);

    const second = recordFeedAffection(day);
    expect(second.delta).toBe(0);
    expect(getSetting('affection.feed_day')).toBe('2026-07-05');
  });

  it('never decreases score', () => {
    recordChatAffection(new Date('2026-07-06T10:00:00'));
    const score = getAffectionScore();
    recordChatAffection(new Date('2026-07-06T11:00:00'));
    for (let i = 0; i < 20; i += 1) {
      recordChatAffection(new Date('2026-07-06T12:00:00'));
    }
    expect(getAffectionScore()).toBeGreaterThanOrEqual(score);
  });

  it('formats prompt block with stage label only', () => {
    const block = formatAffectionForPrompt();
    expect(block).toContain('【当前羁绊】');
    expect(block).toContain('阶段：守望');
    expect(block).not.toMatch(/分数|score|\d+\s*\/\s*100/i);
  });
});
