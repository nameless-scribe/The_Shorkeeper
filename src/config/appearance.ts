import { getSetting, setSetting } from '../db/app-settings';
import type { AppearanceSettingsInfo, BackgroundFitMode, ThemePresetSummary } from '../shared/types';
import {
  getThemeAssetsRecord,
  resolveAppearanceAssetUrl,
} from './appearance-assets';
import {
  DEFAULT_THEME_ID,
  getThemePreset,
  listThemePresets,
} from './themes';

const PRESET_KEY = 'ui.theme.preset_id';
const VEIL_OPACITY_KEY = 'ui.theme.veil_opacity';
const BG_FIT_KEY = 'ui.theme.bg_fit';

function getBackgroundFit(): BackgroundFitMode {
  const raw = getSetting(BG_FIT_KEY);
  return raw === 'contain' ? 'contain' : 'cover';
}

function getPresetId(): string {
  const raw = getSetting(PRESET_KEY);
  if (!raw) return DEFAULT_THEME_ID;
  const preset = getThemePreset(raw);
  return preset.id;
}

function getVeilOpacity(presetDefault: number, hasCustomBackground: boolean): number {
  const raw = getSetting(VEIL_OPACITY_KEY);
  if (raw != null) {
    const parsed = Number.parseFloat(raw);
    if (!Number.isNaN(parsed)) {
      return Math.min(1, Math.max(0, parsed));
    }
  }
  if (hasCustomBackground) return 0.85;
  return presetDefault;
}

export function setAppearancePreset(presetId: string): AppearanceSettingsInfo {
  const preset = getThemePreset(presetId);
  const assetsBefore = getThemeAssetsRecord();
  setSetting(PRESET_KEY, preset.id);
  const assetsAfter = getThemeAssetsRecord();
  if (assetsBefore.background && !assetsAfter.background) {
    throw new Error('setAppearancePreset must not clear custom background');
  }
  return getAppearanceSettings();
}

export function setVeilOpacity(opacity: number): AppearanceSettingsInfo {
  const clamped = Math.min(1, Math.max(0, opacity));
  setSetting(VEIL_OPACITY_KEY, String(clamped));
  return getAppearanceSettings();
}

export function setBackgroundFit(fit: BackgroundFitMode): AppearanceSettingsInfo {
  setSetting(BG_FIT_KEY, fit === 'contain' ? 'contain' : 'cover');
  return getAppearanceSettings();
}

export function getAppearanceSettings(): AppearanceSettingsInfo {
  const presetId = getPresetId();
  const preset = getThemePreset(presetId);
  const assetsRecord = getThemeAssetsRecord();
  const hasCustomBackground = Boolean(assetsRecord.background);

  const presets: ThemePresetSummary[] = listThemePresets().map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    swatchDeep: p.colors.navyDeep,
    swatchAccent: p.colors.cyan,
  }));

  const customBg = resolveAppearanceAssetUrl(assetsRecord.background);
  const customKeeper = resolveAppearanceAssetUrl(assetsRecord.keeperAvatar);
  const customUser = resolveAppearanceAssetUrl(assetsRecord.userAvatar);

  return {
    presetId: preset.id,
    presetName: preset.name,
    presets,
    colors: preset.colors,
    assets: {
      backgroundUrl: customBg,
      keeperAvatarUrl: customKeeper ?? '',
      userAvatarUrl: customUser ?? '',
      builtinBackground: preset.backgrounds.scene,
      builtinKeeperAvatar: preset.defaultAvatars.keeper,
      builtinUserAvatar: preset.defaultAvatars.user,
    },
    veil: preset.veil,
    hasCustomAssets: Boolean(
      assetsRecord.background || assetsRecord.keeperAvatar || assetsRecord.userAvatar,
    ),
    backgroundFit: getBackgroundFit(),
    veilOpacity: getVeilOpacity(preset.defaultVeilOpacity, hasCustomBackground),
    showStars: preset.backgrounds.stars ?? false,
  };
}
