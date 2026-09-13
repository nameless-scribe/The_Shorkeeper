import { getJsonSetting, setJsonSetting } from '../db/app-settings';
import type { WebSearchSettingsInfo, WebSearchSettingsPatch } from '../shared/types';
import { maskApiKey } from '../models/config';
import {
  isProtectedSecret,
  protectSecret,
  revealSecret,
} from '../security/secret-storage';

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
    const apiKey = revealSecret(stored.apiKey.trim());
    if (!isProtectedSecret(stored.apiKey)) saveStored({ apiKey });
    return { apiKey };
  } catch {
    return null;
  }
}

function saveStored(config: StoredWebSearchConfig): void {
  setJsonSetting(WEB_SEARCH_CONFIG_KEY, {
    apiKey: protectSecret(config.apiKey),
  });
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
  saveStored(current);
  return getWebSearchSettingsInfo();
}
