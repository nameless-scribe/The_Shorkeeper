import { describe, expect, it, vi, beforeEach } from 'vitest';

const store: Record<string, string> = {};

vi.mock('../../db/app-settings', () => ({
  getSetting: vi.fn((key: string) => store[key] ?? null),
  setSetting: vi.fn((key: string, value: string) => {
    store[key] = value;
  }),
  getJsonSetting: vi.fn(() => ({})),
  setJsonSetting: vi.fn(),
}));

vi.mock('../appearance-assets', () => ({
  getThemeAssetsRecord: vi.fn(() => ({})),
  resolveAppearanceAssetUrl: vi.fn(() => null),
}));

import { getAppearanceSettings, setAppearancePreset, setBackgroundFit } from '../appearance';

describe('appearance config', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) {
      delete store[key];
    }
  });

  it('defaults to shorekeeper preset', () => {
    const info = getAppearanceSettings();
    expect(info.presetId).toBe('shorekeeper');
    expect(info.presetName).toBe('守岸人 · 星空');
    expect(info.presets.length).toBe(3);
    expect(info.backgroundFit).toBe('cover');
  });

  it('setAppearancePreset switches preset', () => {
    const info = setAppearancePreset('midnight');
    expect(info.presetId).toBe('midnight');
    expect(info.presetName).toBe('午夜紫');
    expect(store['ui.theme.preset_id']).toBe('midnight');
  });

  it('setBackgroundFit persists fit mode', () => {
    const info = setBackgroundFit('contain');
    expect(info.backgroundFit).toBe('contain');
    expect(store['ui.theme.bg_fit']).toBe('contain');
  });
});
