import { deleteSetting, getSetting, setSetting } from '../db/app-settings';
import { getDatabase } from '../db';
import { normalizeErpOrigin } from '../erp/contracts';
import { isProtectedSecret, protectSecretStrict, revealSecret } from '../security/secret-storage';
import type { ErpBrowserChannel, ErpSettingsInfo, ErpSettingsPatch } from '../shared/types';

export const ERP_SETTING_KEYS = {
  enabled: 'erp.enabled', origin: 'erp.origin', apiPrefix: 'erp.apiPrefix', browserChannel: 'erp.browserChannel',
  username: 'erp.username', password: 'erp.password',
} as const;

const DEFAULT_API_PREFIX = '/prod-api';
const DEFAULT_CHANNEL: ErpBrowserChannel = 'msedge';

export interface ErpRuntimeSettings {
  enabled: boolean;
  origin: string;
  apiPrefix: string;
  browserChannel: ErpBrowserChannel;
  username: string;
  password: string;
}

function setting(key: string): string {
  return getSetting(key)?.trim() ?? '';
}

function parseEnabled(value: string): boolean {
  return ['1', 'true', 'on', 'yes'].includes(value.toLowerCase());
}

function parseChannel(value: string): ErpBrowserChannel {
  return value === 'chrome' ? 'chrome' : DEFAULT_CHANNEL;
}

export function normalizeErpApiPrefix(value: string): string {
  const prefix = value.trim().replace(/\/+$/, '');
  if (!/^\/[A-Za-z0-9/_-]{0,100}$/.test(prefix) || prefix.includes('..')) throw new Error('ERP API 前缀无效');
  return prefix;
}

function storedPassword(): string {
  const raw = setting(ERP_SETTING_KEYS.password);
  if (!raw) return '';
  if (!isProtectedSecret(raw)) throw new Error('ERP 密码不是受保护格式，已拒绝读取；请重新保存或使用人工登录');
  return revealSecret(raw);
}

export function resolveErpSettings(): ErpRuntimeSettings {
  const rawOrigin = setting(ERP_SETTING_KEYS.origin);
  return {
    enabled: parseEnabled(setting(ERP_SETTING_KEYS.enabled)),
    origin: rawOrigin ? normalizeErpOrigin(rawOrigin) : '',
    apiPrefix: normalizeErpApiPrefix(setting(ERP_SETTING_KEYS.apiPrefix) || DEFAULT_API_PREFIX),
    browserChannel: parseChannel(setting(ERP_SETTING_KEYS.browserChannel)),
    username: setting(ERP_SETTING_KEYS.username),
    password: storedPassword(),
  };
}

export function getErpSettingsInfo(): ErpSettingsInfo {
  let settings: ErpRuntimeSettings;
  try {
    settings = resolveErpSettings();
  } catch (error) {
    return {
      enabled: parseEnabled(setting(ERP_SETTING_KEYS.enabled)), origin: setting(ERP_SETTING_KEYS.origin),
      apiPrefix: setting(ERP_SETTING_KEYS.apiPrefix) || DEFAULT_API_PREFIX, browserChannel: parseChannel(setting(ERP_SETTING_KEYS.browserChannel)),
      username: setting(ERP_SETTING_KEYS.username), passwordConfigured: Boolean(setting(ERP_SETTING_KEYS.password)), configured: false,
      reason: error instanceof Error ? error.message : 'ERP 配置无效',
    };
  }
  const missing = [!settings.origin && '站点地址', !settings.username && '账号'].filter(Boolean);
  return {
    enabled: settings.enabled, origin: settings.origin, apiPrefix: settings.apiPrefix, browserChannel: settings.browserChannel,
    username: settings.username, passwordConfigured: Boolean(settings.password), configured: missing.length === 0,
    reason: missing.length ? `ERP 尚未配置：缺少 ${missing.join('、')}` : null,
  };
}

export function saveErpSettings(patch: ErpSettingsPatch): ErpSettingsInfo {
  const origin = patch.origin?.trim();
  const normalizedOrigin = origin ? normalizeErpOrigin(origin) : '';
  const apiPrefix = patch.apiPrefix === undefined ? undefined : normalizeErpApiPrefix(patch.apiPrefix || DEFAULT_API_PREFIX);
  if (patch.browserChannel !== undefined && patch.browserChannel !== 'msedge' && patch.browserChannel !== 'chrome') {
    throw new Error('不支持的 ERP 浏览器');
  }
  const username = patch.username?.trim();
  if (username !== undefined && [...username].length > 200) throw new Error('ERP 账号过长');
  const password = patch.password?.trim();
  if (password && [...password].length > 1_000) throw new Error('ERP 密码过长');
  const protectedPassword = password ? protectSecretStrict(password) : '';

  getDatabase().transaction(() => {
    if (patch.clearCredentials) {
      deleteSetting(ERP_SETTING_KEYS.username);
      deleteSetting(ERP_SETTING_KEYS.password);
    }
    if (patch.enabled !== undefined) setSetting(ERP_SETTING_KEYS.enabled, patch.enabled ? '1' : '0');
    if (origin !== undefined) {
      if (normalizedOrigin) setSetting(ERP_SETTING_KEYS.origin, normalizedOrigin);
      else deleteSetting(ERP_SETTING_KEYS.origin);
    }
    if (apiPrefix !== undefined) setSetting(ERP_SETTING_KEYS.apiPrefix, apiPrefix);
    if (patch.browserChannel !== undefined) setSetting(ERP_SETTING_KEYS.browserChannel, patch.browserChannel);
    if (username !== undefined) {
      if (username) setSetting(ERP_SETTING_KEYS.username, username);
      else deleteSetting(ERP_SETTING_KEYS.username);
    }
    if (protectedPassword) setSetting(ERP_SETTING_KEYS.password, protectedPassword);
  });
  return getErpSettingsInfo();
}
