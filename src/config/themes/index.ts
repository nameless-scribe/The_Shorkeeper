import { DAWN_THEME } from './dawn';
import { DEEP_SEA_THEME } from './deep-sea';
import { FOREST_THEME } from './forest';
import { MIDNIGHT_THEME } from './midnight';
import { NEON_THEME } from './neon';
import { SAKURA_THEME } from './sakura';
import { SHOREKEEPER_THEME } from './shorekeeper';
import { SLATE_THEME } from './slate';
import { TWILIGHT_THEME } from './twilight';
import type { ThemePreset } from './types';

export type { ThemePreset } from './types';

const PRESETS: ThemePreset[] = [
  SHOREKEEPER_THEME,
  MIDNIGHT_THEME,
  DAWN_THEME,
  DEEP_SEA_THEME,
  FOREST_THEME,
  SAKURA_THEME,
  TWILIGHT_THEME,
  SLATE_THEME,
  NEON_THEME,
];

const PRESET_MAP = new Map(PRESETS.map((p) => [p.id, p]));

export const DEFAULT_THEME_ID = 'shorekeeper';

export function listThemePresets(): ThemePreset[] {
  return PRESETS;
}

export function getThemePreset(id: string): ThemePreset {
  return PRESET_MAP.get(id) ?? SHOREKEEPER_THEME;
}
