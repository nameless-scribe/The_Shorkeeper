import { beforeEach, describe, expect, it, vi } from 'vitest';

const store: Record<string, string> = {};

vi.mock('../../db/app-settings', () => ({
  getSetting: vi.fn((key: string) => store[key] ?? null),
  setSetting: vi.fn((key: string, value: string) => {
    store[key] = value;
  }),
  getJsonSetting: vi.fn((key: string) => {
    const raw = store[key];
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  }),
  setJsonSetting: vi.fn((key: string, value: unknown) => {
    store[key] = JSON.stringify(value);
  }),
}));

vi.mock('../appearance-assets', () => ({
  getThemeAssetsRecord: vi.fn(() => JSON.parse(store['ui.theme.assets'] ?? '{}')),
  resolveAppearanceAssetUrl: vi.fn((rel: string | null | undefined) =>
    rel ? `sk-asset://local/${rel}` : null,
  ),
}));

import { getAppearanceSettings, setAppearancePreset } from '../appearance';

describe('setAppearancePreset preserves custom background', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) {
      delete store[key];
    }
    store['ui.theme.assets'] = JSON.stringify({ background: 'bg-user-abc.png' });
  });

  it('keeps background filename when switching preset', () => {
    setAppearancePreset('midnight');
    const info = getAppearanceSettings();
    expect(info.presetId).toBe('midnight');
    expect(info.assets.backgroundUrl).toBe('sk-asset://local/bg-user-abc.png');
  });
});
