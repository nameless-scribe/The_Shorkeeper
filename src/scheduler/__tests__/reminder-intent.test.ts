import { describe, expect, it } from 'vitest';
import {
  buildDailyCron,
  parseReminderClock,
  parseScheduleReminderIntent,
} from '../reminder-intent';

describe('parseReminderClock', () => {
  it('parses 下午五点半', () => {
    expect(parseReminderClock('每天下午五点半提醒我')).toEqual({ hour: 17, minute: 30 });
  });

  it('parses 17:30', () => {
    expect(parseReminderClock('17:30 提醒')).toEqual({ hour: 17, minute: 30 });
  });

  it('parses 上午九点', () => {
    expect(parseReminderClock('上午九点叫我')).toEqual({ hour: 9, minute: 0 });
  });
});

describe('parseScheduleReminderIntent', () => {
  it('creates recurring daily reminder from natural language', () => {
    const intent = parseScheduleReminderIntent('每天下午五点半提醒我下班时间到了哦');
    expect(intent).toMatchObject({
      triggered: true,
      action: 'create',
      scheduleKind: 'recurring',
      cron: '30 17 * * *',
      name: '下班提醒',
      message: '下班时间到',
    });
  });

  it('creates once reminder for tomorrow', () => {
    const intent = parseScheduleReminderIntent('明天上午10点提醒我开会');
    expect(intent).toMatchObject({
      triggered: true,
      action: 'create',
      scheduleKind: 'once',
      name: '开会',
      message: '开会',
    });
    if (intent.triggered && intent.action === 'create' && intent.scheduleKind === 'once') {
      expect(intent.runAt).toBeGreaterThan(Date.now());
    }
  });

  it('detects list intent', () => {
    expect(parseScheduleReminderIntent('列出我的定时提醒')).toEqual({
      triggered: true,
      action: 'list',
    });
  });

  it('detects delete intent', () => {
    expect(parseScheduleReminderIntent('取消下班提醒')).toMatchObject({
      triggered: true,
      action: 'delete',
      nameHint: '下班',
    });
  });

  it('ignores how-to questions', () => {
    expect(parseScheduleReminderIntent('怎么设置定时提醒？')).toEqual({ triggered: false });
  });

  it('ignores messages without time', () => {
    expect(parseScheduleReminderIntent('记得提醒我下班')).toEqual({ triggered: false });
  });
});

describe('buildDailyCron', () => {
  it('formats node-cron expression', () => {
    expect(buildDailyCron(17, 30)).toBe('30 17 * * *');
  });
});
