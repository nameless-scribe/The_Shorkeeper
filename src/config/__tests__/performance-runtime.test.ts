import { beforeEach, describe, expect, it, vi } from 'vitest';

const settings = vi.hoisted(() => new Map<string, string>());

vi.mock('../../db/app-settings', () => ({
  getSetting: (key: string) => settings.get(key) ?? null,
  setSetting: (key: string, value: string) => settings.set(key, value),
}));

import { getPerformanceSettings, savePerformanceSettings } from '../performance';

describe('performance runtime normalization', () => {
  beforeEach(() => settings.clear());

  it('clamps history, compression, extraction, and context limits from storage', () => {
    settings.set('MAX_HISTORY_MESSAGES', '999');
    settings.set('COMPRESS_THRESHOLD', '-10');
    settings.set('MEMORY_EXTRACT_INTERVAL', '0');
    settings.set('CONTEXT_MAX_INPUT_TOKENS', '999999');

    expect(getPerformanceSettings()).toMatchObject({
      maxHistoryMessages: 60,
      compressThreshold: 20,
      memoryExtractInterval: 1,
      contextMaxInputTokens: 120_000,
    });
  });

  it('returns normalized values after an IPC-style settings update', () => {
    expect(savePerformanceSettings({
      maxHistoryMessages: -5,
      compressThreshold: 999,
    })).toMatchObject({
      maxHistoryMessages: 6,
      compressThreshold: 200,
    });
  });
});
