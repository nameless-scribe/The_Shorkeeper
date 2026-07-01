import { DAWN_THEME } from './dawn';
import { MIDNIGHT_THEME } from './midnight';
import { SHOREKEEPER_THEME } from './shorekeeper';
import type { ThemePreset } from './types';

export type { ThemePreset } from './types';

const PRESETS: ThemePreset[] = [SHOREKEEPER_THEME, MIDNIGHT_THEME, DAWN_THEME];

const PRESET_MAP = new Map(PRESETS.map((p) => [p.id, p]));

export const DEFAULT_THEME_ID = 'shorekeeper';

export function listThemePresets(): ThemePreset[] {
  return PRESETS;
}

export function getThemePreset(id: string): ThemePreset {
  return PRESET_MAP.get(id) ?? SHOREKEEPER_THEME;
}
