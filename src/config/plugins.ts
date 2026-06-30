import { getSetting, setSetting } from '../db/app-settings';

export type FilesystemMode = 'readonly' | 'confirm' | 'full';

export interface PluginSettings {
  webSearch: boolean;
  fetchUrl: boolean;
  docGen: boolean;
  bookkeeping: boolean;
  lifeTools: boolean;
  filesystemMode: FilesystemMode;
}

const SETTINGS_KEY = 'plugins.settings';

const DEFAULTS: PluginSettings = {
  webSearch: true,
  fetchUrl: true,
  docGen: true,
  bookkeeping: true,
  lifeTools: true,
  filesystemMode: 'confirm',
};

const TOOL_PLUGIN: Record<string, keyof Pick<PluginSettings, 'webSearch' | 'fetchUrl' | 'docGen' | 'bookkeeping' | 'lifeTools'>> = {
  web_search: 'webSearch',
  fetch_url: 'fetchUrl',
  read_xlsx: 'docGen',
  convert_to_markdown: 'docGen',
  gen_markdown: 'docGen',
  gen_docx: 'docGen',
  gen_xlsx: 'docGen',
  gen_pdf: 'docGen',
  bookkeeping: 'bookkeeping',
  travel_plan: 'lifeTools',
  get_weather: 'lifeTools',
  translate: 'lifeTools',
};

export function getPluginSettings(): PluginSettings {
  const raw = getSetting(SETTINGS_KEY);
  if (!raw) return { ...DEFAULTS };

  try {
    const parsed = JSON.parse(raw) as Partial<PluginSettings>;
    return {
      webSearch: parsed.webSearch ?? DEFAULTS.webSearch,
      fetchUrl: parsed.fetchUrl ?? DEFAULTS.fetchUrl,
      docGen: parsed.docGen ?? DEFAULTS.docGen,
      bookkeeping: parsed.bookkeeping ?? DEFAULTS.bookkeeping,
      lifeTools: parsed.lifeTools ?? DEFAULTS.lifeTools,
      filesystemMode: parsed.filesystemMode ?? DEFAULTS.filesystemMode,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePluginSettings(patch: Partial<PluginSettings>): PluginSettings {
  const next = { ...getPluginSettings(), ...patch };
  setSetting(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

export function isPluginToolEnabled(toolName: string, settings: PluginSettings): boolean {
  if (toolName === 'write_file') {
    return settings.filesystemMode !== 'readonly';
  }

  const pluginKey = TOOL_PLUGIN[toolName];
  if (!pluginKey) return true;

  if (!settings[pluginKey]) return false;

  if ((toolName.startsWith('gen_') || toolName === 'read_xlsx' || toolName === 'convert_to_markdown') && settings.filesystemMode === 'readonly') {
    return false;
  }

  return true;
}

export function pluginSettingsCacheKey(settings: PluginSettings): string {
  return JSON.stringify(settings);
}

export function needsNetwork(settings: PluginSettings): boolean {
  return settings.webSearch || settings.fetchUrl || settings.lifeTools;
}
