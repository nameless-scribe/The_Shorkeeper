import { describe, expect, it } from 'vitest';
import {
  getStaticReminderBody,
  normalizeReminderBody,
  shouldGenerateAiReminder,
} from '../reminder-message';

describe('reminder-message', () => {
  it('reads static body from payload message', () => {
    expect(getStaticReminderBody({ message: ' 该休息了 ' }, '休息')).toBe('该休息了');
  });

  it('falls back to task name', () => {
    expect(getStaticReminderBody({}, '休息')).toBe('休息');
  });

  it('defaults ai_message to enabled', () => {
    expect(shouldGenerateAiReminder({})).toBe(true);
    expect(shouldGenerateAiReminder({ ai_message: false })).toBe(false);
  });

  it('normalizes and truncates generated text', () => {
    expect(normalizeReminderBody('「你好呀」')).toBe('你好呀');
    const long = 'a'.repeat(200);
    expect(normalizeReminderBody(long).length).toBeLessThanOrEqual(160);
  });
});
