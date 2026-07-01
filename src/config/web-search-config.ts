import { getJsonSetting, setJsonSetting } from '../db/app-settings';
import type { WebSearchSettingsInfo, WebSearchSettingsPatch } from '../shared/types';
import { maskApiKey } from '../models/config';

export const WEB_SEARCH_CONFIG_KEY = 'web_search.config';

interface StoredWebSearchConfig {
  apiKey: string;
}

function envApiKey(): string {
  return (
    process.env.WEB_SEARCH_API_KEY?.trim() ||
    process.env.BOCHA_API_KEY?.trim() ||
    ''
  );
}

function loadStored(): StoredWebSearchConfig | null {
  try {
    const stored = getJsonSetting<StoredWebSearchConfig>(WEB_SEARCH_CONFIG_KEY);
    if (!stored?.apiKey?.trim()) return null;
    return { apiKey: stored.apiKey.trim() };
  } catch {
    return null;
  }
}

function saveStored(config: StoredWebSearchConfig): void {
  setJsonSetting(WEB_SEARCH_CONFIG_KEY, config);
}

export function getWebSearchApiKey(): string {
  return loadStored()?.apiKey || envApiKey();
}

export function getWebSearchSettingsInfo(): WebSearchSettingsInfo {
  const apiKey = getWebSearchApiKey();
  const fromEnv = !loadStored()?.apiKey && Boolean(envApiKey());
  return {
    apiKeyMasked: apiKey ? maskApiKey(apiKey) : '',
    apiKeyConfigured: apiKey.length > 0,
    provider: 'bocha',
    source: fromEnv ? 'env' : apiKey ? 'app' : 'none',
  };
}

export function saveWebSearchSettings(patch: WebSearchSettingsPatch): WebSearchSettingsInfo {
  const current = loadStored() ?? { apiKey: '' };
  if (patch.apiKey !== undefined && patch.apiKey.trim()) {
    current.apiKey = patch.apiKey.trim();
  }
  try {
    saveStored(current);
  } catch {
    // DB 未就绪时忽略持久化；运行时仍可用 .env
  }
  return getWebSearchSettingsInfo();
}
