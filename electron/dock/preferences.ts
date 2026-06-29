import { getJsonSetting, setJsonSetting } from '../../src/db/app-settings';

export const DOCK_SETTING_KEYS = {
  alwaysOnTop: 'dock.always_on_top',
  positionLocked: 'dock.position_locked',
} as const;

export interface DockPreferences {
  alwaysOnTop: boolean;
  positionLocked: boolean;
}

const DEFAULTS: DockPreferences = {
  alwaysOnTop: true,
  positionLocked: false,
};

function readBool(key: string, fallback: boolean): boolean {
  const raw = getJsonSetting<boolean>(key);
  return typeof raw === 'boolean' ? raw : fallback;
}

export function getDockPreferences(): DockPreferences {
  return {
    alwaysOnTop: readBool(DOCK_SETTING_KEYS.alwaysOnTop, DEFAULTS.alwaysOnTop),
    positionLocked: readBool(DOCK_SETTING_KEYS.positionLocked, DEFAULTS.positionLocked),
  };
}

export function setDockAlwaysOnTop(enabled: boolean): DockPreferences {
  setJsonSetting(DOCK_SETTING_KEYS.alwaysOnTop, enabled);
  return getDockPreferences();
}

export function setDockPositionLocked(locked: boolean): DockPreferences {
  setJsonSetting(DOCK_SETTING_KEYS.positionLocked, locked);
  return getDockPreferences();
}
