import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  completeChat: vi.fn(),
  config: null as null | {
    apiKey: string;
    baseUrl: string;
    model: string;
    protocol: 'openai';
    profileId: string;
  },
}));

vi.mock('../../models/complete-chat', () => ({
  completeChat: (...args: unknown[]) => state.completeChat(...args),
}));

vi.mock('../../models/config', () => ({
  getModelRuntimeConfigSafe: () => state.config,
}));

vi.mock('../../agent/stable-context', () => ({
  getStableSystemPrefix: () => 'stable prefix',
}));

import {
  getStaticReminderBody,
  normalizeReminderBody,
  resolveReminderBody,
  shouldGenerateAiReminder,
} from '../reminder-message';

const task = {
  id: 'reminder-1',
  name: '休息',
  scheduleKind: 'once' as const,
  cron: '',
  runAt: Date.now(),
  actionType: 'notify',
  actionPayload: '{}',
  enabled: true,
  lastRunAt: null,
};

describe('reminder-message', () => {
  beforeEach(() => {
    state.completeChat.mockReset();
    state.config = null;
  });

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

  it('falls back when the reminder model does not settle before its timeout', async () => {
    state.config = {
      apiKey: 'test-key',
      baseUrl: 'https://example.test',
      model: 'test-model',
      protocol: 'openai',
      profileId: 'profile-1',
    };
    state.completeChat.mockReturnValue(new Promise(() => undefined));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(resolveReminderBody(
      task,
      { message: '该休息了' },
      { timeoutMs: 10 },
    )).resolves.toBe('该休息了');

    expect(state.completeChat).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
