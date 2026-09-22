import { describe, expect, it } from 'vitest';
import {
  calculateDailyBudget,
  digestErpPayload,
  parseDraftItems,
  validateDraftForSubmission,
} from '../contracts';
import { parseExplicitDurationMinutes } from '../duration';

function item(overrides: Record<string, unknown> = {}) {
  return {
    itemId: 'item-1',
    taskId: '42',
    taskName: 'APS 自动排产系统调整',
    projectName: '光拓智能日常',
    workMinutes: 210,
    workContent: '调整排产算法，修复扫描问题。',
    durationEstimated: false,
    sourceMessageIds: ['message-1'],
    ...overrides,
  };
}

describe('ERP report contracts', () => {
  it('accepts one-decimal-hour precision including 0.5 hours', () => {
    expect(parseDraftItems([item({ workMinutes: 30 })])[0].workMinutes).toBe(30);
    expect(parseDraftItems([item({ workMinutes: 36 })])[0].workMinutes).toBe(36);
    expect(() => parseDraftItems([item({ workMinutes: 31 })])).toThrow('一位小时小数');
  });

  it('requires matched tasks and definite durations before submission', () => {
    const items = parseDraftItems([item({ taskId: null, workMinutes: null, durationEstimated: true })]);
    expect(validateDraftForSubmission(items)).toMatchObject({ ready: false, draftMinutes: 0 });
    expect(validateDraftForSubmission(items).errors).toHaveLength(3);
  });

  it('calculates the daily eight-hour limit in integer minutes', () => {
    const items = parseDraftItems([item({ workMinutes: 30 })]);
    expect(calculateDailyBudget(450, items)).toEqual({
      existingMinutes: 450,
      draftMinutes: 30,
      totalMinutes: 480,
      remainingMinutes: 0,
    });
    expect(() => calculateDailyBudget(451, items)).toThrow('超过 8 小时');
  });

  it('parses only explicit durations and leaves ambiguous language unresolved', () => {
    expect(parseExplicitDurationMinutes('三个半小时')).toBe(210);
    expect(parseExplicitDurationMinutes('0.5小时')).toBe(30);
    expect(parseExplicitDurationMinutes('半小时')).toBe(30);
    expect(parseExplicitDurationMinutes('一上午')).toBeNull();
    expect(parseExplicitDurationMinutes('大约两小时')).toBeNull();
    expect(parseExplicitDurationMinutes('三四小时')).toBeNull();
  });

  it('creates a stable digest regardless of object key order', () => {
    expect(digestErpPayload({ b: 2, a: 1 })).toBe(digestErpPayload({ a: 1, b: 2 }));
  });
});

