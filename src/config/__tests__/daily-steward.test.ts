import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDatabase, initDatabase } from '../../db';
import { listScheduledTasks } from '../../db/scheduled-tasks';
import { setTaskChangeHandler } from '../../scheduler/task-events';
import {
  applyDailyStewardSchedule,
  clockToCron,
  getDailyStewardSettings,
  normalizeClock,
  saveDailyStewardSettings,
  STEWARD_MARKER_KEY,
} from '../daily-steward';

describe('daily steward settings and schedule', () => {
  let tempDir: string;
  const changes = vi.fn();

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-steward-config-'));
    await initDatabase(path.join(tempDir, 'steward.db'));
    changes.mockReset();
    setTaskChangeHandler(changes);
  });

  afterEach(() => {
    setTaskChangeHandler(() => undefined);
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('normalises clocks and converts them to cron', () => {
    expect(normalizeClock('8:05')).toBe('08:05');
    expect(normalizeClock('23:59')).toBe('23:59');
    expect(normalizeClock('24:00')).toBeNull();
    expect(normalizeClock('9')).toBeNull();
    expect(clockToCron('08:00')).toBe('0 8 * * *');
    expect(clockToCron('21:30')).toBe('30 21 * * *');
    expect(() => clockToCron('bad')).toThrow('无效时间');
  });

  it('stores settings with defaults and rejects invalid times', () => {
    expect(getDailyStewardSettings()).toEqual({ enabled: false, morningTime: '08:00', eveningTime: '21:30', popup: true });
    expect(saveDailyStewardSettings({ enabled: true, morningTime: '7:30' })).toMatchObject({ enabled: true, morningTime: '07:30' });
    expect(() => saveDailyStewardSettings({ eveningTime: '25:00' })).toThrow('HH:MM');
    expect(getDailyStewardSettings().morningTime).toBe('07:30');
  });

  it('creates two system tasks once, updates them in place and disables them when turned off', () => {
    const on = applyDailyStewardSchedule({ enabled: true, morningTime: '08:00', eveningTime: '21:30', popup: true });
    expect(on.morning).toMatchObject({ name: '每日管家·早间简报', cron: '0 8 * * *', actionType: 'agent_prompt', enabled: true });
    expect(on.evening).toMatchObject({ name: '每日管家·晚间复盘', cron: '30 21 * * *', enabled: true });
    const payload = JSON.parse(on.morning!.actionPayload) as Record<string, unknown>;
    expect(payload).toMatchObject({ respect_quiet_hours: true, popup_title: '早间简报已准备好', [STEWARD_MARKER_KEY]: 'daily_steward_morning' });
    expect(String(payload.prompt)).toContain('build_daily_brief');
    expect(listScheduledTasks()).toHaveLength(2);
    expect(changes).toHaveBeenCalledTimes(1);

    // Re-applying identical settings is a no-op.
    applyDailyStewardSchedule({ enabled: true, morningTime: '08:00', eveningTime: '21:30', popup: true });
    expect(listScheduledTasks()).toHaveLength(2);
    expect(changes).toHaveBeenCalledTimes(1);

    // Changing the time and popup updates the same rows.
    const moved = applyDailyStewardSchedule({ enabled: true, morningTime: '07:15', eveningTime: '21:30', popup: false });
    expect(moved.morning?.id).toBe(on.morning?.id);
    expect(moved.morning?.cron).toBe('15 7 * * *');
    expect(JSON.parse(moved.morning!.actionPayload)).not.toHaveProperty('popup_title');
    expect(listScheduledTasks()).toHaveLength(2);

    const off = applyDailyStewardSchedule({ enabled: false, morningTime: '07:15', eveningTime: '21:30', popup: false });
    expect(off.morning?.enabled).toBe(false);
    expect(off.evening?.enabled).toBe(false);
    expect(listScheduledTasks().filter((task) => task.enabled)).toEqual([]);

    // Turning back on re-enables the existing rows instead of creating duplicates.
    applyDailyStewardSchedule({ enabled: true, morningTime: '07:15', eveningTime: '21:30', popup: false });
    expect(listScheduledTasks()).toHaveLength(2);
    expect(listScheduledTasks().every((task) => task.enabled)).toBe(true);
  });
});
