import { v4 as uuid } from 'uuid';
import { getJsonSetting, getSetting, setJsonSetting, setSetting } from '../db/app-settings';
import type {
  ModelConfig,
  ModelProfileInfo,
  ModelProfileInput,
  ModelProfilePatch,
  ModelProfilesInfo,
  ModelProtocol,
  ModelSettingsInfo,
  ModelSettingsPatch,
} from '../shared/types';

export type { ModelProtocol };

export const MODEL_PROTOCOL_KEY = 'model.protocol';
export const MODEL_API_KEY_SETTING = 'model.api_key';
export const MODEL_BASE_URL_SETTING = 'model.base_url';
export const MODEL_ID_SETTING = 'model.id';
export const MODEL_PROFILES_KEY = 'model.profiles';

const DEFAULT_MODEL = 'qwen3.6-plus';

interface StoredModelProfile {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  protocol: ModelProtocol;
}

interface StoredProfilesState {
  activeId: string | null;
  profiles: StoredModelProfile[];
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/$/, '');
}

function parseProtocol(raw: string | null | undefined): ModelProtocol {
  return raw === 'anthropic' ? 'anthropic' : 'openai';
}

function readGlobalProtocol(): ModelProtocol {
  try {
    return parseProtocol(getSetting(MODEL_PROTOCOL_KEY));
  } catch {
    return 'openai';
  }
}

function loadProfilesState(): StoredProfilesState {
  const stored = getJsonSetting<StoredProfilesState>(MODEL_PROFILES_KEY);
  if (stored?.profiles?.length) {
    return {
      activeId: stored.activeId,
      profiles: stored.profiles.map((p) => ({
        id: p.id,
        name: p.name?.trim() || '未命名配置',
        baseUrl: p.baseUrl ? normalizeBaseUrl(p.baseUrl) : '',
        model: p.model?.trim() || DEFAULT_MODEL,
        apiKey: p.apiKey?.trim() ?? '',
        protocol: parseProtocol(p.protocol),
      })),
    };
  }

  const apiKey = getSetting(MODEL_API_KEY_SETTING);
  const baseUrl = getSetting(MODEL_BASE_URL_SETTING);
  const model = getSetting(MODEL_ID_SETTING);
  if (apiKey || baseUrl || model) {
    const id = uuid();
    const migrated: StoredProfilesState = {
      activeId: id,
      profiles: [
        {
          id,
          name: model?.trim() || '默认配置',
          baseUrl: baseUrl ? normalizeBaseUrl(baseUrl) : '',
          model: model?.trim() || DEFAULT_MODEL,
          apiKey: apiKey?.trim() ?? '',
          protocol: readGlobalProtocol(),
        },
      ],
    };
    setJsonSetting(MODEL_PROFILES_KEY, migrated);
    return migrated;
  }

  return { activeId: null, profiles: [] };
}

function saveProfilesState(state: StoredProfilesState): void {
  setJsonSetting(MODEL_PROFILES_KEY, state);
}

function getActiveProfile(state: StoredProfilesState): StoredModelProfile | null {
  if (!state.activeId) return null;
  return state.profiles.find((p) => p.id === state.activeId) ?? null;
}

function resolveFromEnv(): ModelConfig {
  return {
    apiKey: process.env.OPENAI_API_KEY?.trim() ?? '',
    baseUrl: normalizeBaseUrl(process.env.OPENAI_BASE_URL?.trim() ?? ''),
    model: process.env.DEFAULT_MODEL?.trim() || DEFAULT_MODEL,
  };
}

export function maskApiKey(key: string): string {
  if (key.length <= 8) return '••••••••';
  return `${key.slice(0, 3)}${'•'.repeat(Math.min(12, key.length - 7))}${key.slice(-4)}`;
}

function toProfileInfo(profile: StoredModelProfile): ModelProfileInfo {
  return {
    id: profile.id,
    name: profile.name,
    baseUrl: profile.baseUrl,
    model: profile.model,
    protocol: profile.protocol,
    apiKeyMasked: profile.apiKey ? maskApiKey(profile.apiKey) : '',
    apiKeyConfigured: profile.apiKey.length > 0,
  };
}

export function getModelProfilesInfo(): ModelProfilesInfo {
  const state = loadProfilesState();
  return {
    activeId: state.activeId,
    profiles: state.profiles.map(toProfileInfo),
  };
}

export function getModelProtocol(): ModelProtocol {
  const active = getActiveProfile(loadProfilesState());
  if (active) return active.protocol;
  return readGlobalProtocol();
}

export function setModelProtocol(protocol: ModelProtocol): ModelProtocol {
  const state = loadProfilesState();
  const active = getActiveProfile(state);
  if (active) {
    active.protocol = protocol;
    saveProfilesState(state);
    return protocol;
  }
  setSetting(MODEL_PROTOCOL_KEY, protocol);
  return protocol;
}

export function getModelSettingsInfo(): ModelSettingsInfo {
  const state = loadProfilesState();
  const active = getActiveProfile(state);
  if (active) {
    return {
      profileId: active.id,
      name: active.name,
      apiKeyMasked: active.apiKey ? maskApiKey(active.apiKey) : '',
      apiKeyConfigured: active.apiKey.length > 0,
      baseUrl: active.baseUrl,
      model: active.model,
      protocol: active.protocol,
      configuredInApp: true,
    };
  }

  const env = resolveFromEnv();
  return {
    profileId: null,
    name: env.model,
    apiKeyMasked: env.apiKey ? maskApiKey(env.apiKey) : '',
    apiKeyConfigured: env.apiKey.length > 0,
    baseUrl: env.baseUrl,
    model: env.model,
    protocol: readGlobalProtocol(),
    configuredInApp: false,
  };
}

export function createModelProfile(input: ModelProfileInput): ModelProfilesInfo {
  const state = loadProfilesState();
  const id = uuid();
  const profile: StoredModelProfile = {
    id,
    name: input.name.trim() || '未命名配置',
    baseUrl: normalizeBaseUrl(input.baseUrl),
    model: input.model.trim() || DEFAULT_MODEL,
    apiKey: input.apiKey?.trim() ?? '',
    protocol: input.protocol ?? 'openai',
  };
  state.profiles.push(profile);
  if (!state.activeId) {
    state.activeId = id;
  }
  saveProfilesState(state);
  return getModelProfilesInfo();
}

export function updateModelProfile(id: string, patch: ModelProfilePatch): ModelProfilesInfo {
  const state = loadProfilesState();
  const profile = state.profiles.find((p) => p.id === id);
  if (!profile) {
    throw new Error('配置不存在');
  }

  if (patch.name !== undefined) profile.name = patch.name.trim() || profile.name;
  if (patch.baseUrl !== undefined) profile.baseUrl = normalizeBaseUrl(patch.baseUrl);
  if (patch.model !== undefined) profile.model = patch.model.trim() || profile.model;
  if (patch.apiKey !== undefined && patch.apiKey.trim()) {
    profile.apiKey = patch.apiKey.trim();
  }
  if (patch.protocol !== undefined) profile.protocol = patch.protocol;

  saveProfilesState(state);
  return getModelProfilesInfo();
}

export function deleteModelProfile(id: string): ModelProfilesInfo {
  const state = loadProfilesState();
  if (state.profiles.length <= 1) {
    throw new Error('至少保留一个 API 配置');
  }

  state.profiles = state.profiles.filter((p) => p.id !== id);
  if (state.activeId === id) {
    state.activeId = state.profiles[0]?.id ?? null;
  }
  saveProfilesState(state);
  return getModelProfilesInfo();
}

export function setActiveModelProfile(id: string): ModelProfilesInfo {
  const state = loadProfilesState();
  if (!state.profiles.some((p) => p.id === id)) {
    throw new Error('配置不存在');
  }
  state.activeId = id;
  saveProfilesState(state);
  return getModelProfilesInfo();
}

export function saveModelSettings(patch: ModelSettingsPatch): ModelSettingsInfo {
  const state = loadProfilesState();
  let active = getActiveProfile(state);

  if (!active) {
    createModelProfile({
      name: patch.model?.trim() || DEFAULT_MODEL,
      baseUrl: patch.baseUrl?.trim() ?? resolveFromEnv().baseUrl,
      model: patch.model?.trim() || DEFAULT_MODEL,
      apiKey: patch.apiKey?.trim(),
      protocol: patch.protocol ?? readGlobalProtocol(),
    });
    return getModelSettingsInfo();
  }

  updateModelProfile(active.id, patch);
  return getModelSettingsInfo();
}

export function loadModelConfig(): ModelConfig {
  const active = getActiveProfile(loadProfilesState());
  if (active?.apiKey && active.baseUrl) {
    return {
      apiKey: active.apiKey,
      baseUrl: normalizeBaseUrl(active.baseUrl),
      model: active.model,
    };
  }

  const env = resolveFromEnv();
  const apiKey = active?.apiKey || env.apiKey;
  const baseUrl = active?.baseUrl || env.baseUrl;
  const model = active?.model || env.model;

  if (!apiKey) {
    throw new Error(
      '未配置 API Key。请在 设置 → API 设置 填写，或在 .env 设置 OPENAI_API_KEY',
    );
  }

  if (!baseUrl) {
    throw new Error(
      '未配置接入 URL。请在 设置 → API 设置 填写，或在 .env 设置 OPENAI_BASE_URL',
    );
  }

  return { apiKey, baseUrl: normalizeBaseUrl(baseUrl), model };
}

export function getModelConfigSafe(): ModelConfig | null {
  try {
    return loadModelConfig();
  } catch {
    return null;
  }
}

export function shouldIncludeStreamUsage(): boolean {
  return process.env.INCLUDE_STREAM_USAGE === 'true';
}

export function shouldUseExplicitCache(): boolean {
  return process.env.ENABLE_EXPLICIT_CACHE === 'true';
}
