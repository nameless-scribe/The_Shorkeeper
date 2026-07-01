import { getJsonSetting, setJsonSetting } from '../db/app-settings';
import type { EmbeddingSettingsInfo, EmbeddingSettingsPatch } from '../shared/types';
import { getModelConfigSafe, loadModelConfig, maskApiKey } from './config';

export const EMBEDDING_CONFIG_KEY = 'embedding.config';

const DEFAULT_EMBEDDING_MODEL = 'text-embedding-v3';

interface StoredEmbeddingConfig {
  useChatApi: boolean;
  baseUrl: string;
  model: string;
  apiKey: string;
}

function normalizeBaseUrl(url: string): string {
  let normalized = url
    .trim()
    .replace(/\/embeddings\/?$/i, '')
    .replace(/\/$/, '');
  if (/dashscope\.aliyuncs\.com\/compatible-mode$/i.test(normalized)) {
    normalized += '/v1';
  }
  return normalized;
}

export function validateEmbeddingBaseUrl(url: string): void {
  const normalized = normalizeBaseUrl(url);
  if (!normalized) {
    throw new Error('Embedding Base URL 不能为空');
  }
  if (!/^https?:\/\//i.test(normalized)) {
    throw new Error('Embedding Base URL 需以 https:// 开头');
  }
  if (/xxxx/i.test(normalized) || /your[-_]?id/i.test(normalized)) {
    throw new Error(
      'Base URL 仍是文档占位符（含 xxxx），请从百炼控制台复制「你的」OpenAI 兼容接入地址，或改用 https://dashscope.aliyuncs.com/compatible-mode/v1',
    );
  }
}

function envEmbeddingModel(): string {
  return process.env.EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL;
}

function envEmbeddingKey(): string {
  return process.env.EMBEDDING_API_KEY?.trim() ?? '';
}

function envEmbeddingBaseUrl(): string {
  return process.env.EMBEDDING_BASE_URL?.trim()
    ? normalizeBaseUrl(process.env.EMBEDDING_BASE_URL.trim())
    : '';
}

function loadStored(): StoredEmbeddingConfig | null {
  const stored = getJsonSetting<StoredEmbeddingConfig>(EMBEDDING_CONFIG_KEY);
  if (!stored) return null;
  return {
    useChatApi: stored.useChatApi !== false,
    baseUrl: stored.baseUrl ? normalizeBaseUrl(stored.baseUrl) : '',
    model: stored.model?.trim() || envEmbeddingModel(),
    apiKey: stored.apiKey?.trim() ?? '',
  };
}

function saveStored(config: StoredEmbeddingConfig): void {
  setJsonSetting(EMBEDDING_CONFIG_KEY, config);
}

export function getEmbeddingModelName(): string {
  const stored = loadStored();
  if (stored && !stored.useChatApi && stored.model) {
    return stored.model;
  }
  return envEmbeddingModel();
}

export interface EmbeddingApiConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/**
 * 加载 RAG / 记忆向量用的 API 配置。
 * useChatApi=true（默认）时与对话 API 相同；否则使用单独配置的 Embedding 接入。
 */
export function loadEmbeddingConfig(): EmbeddingApiConfig {
  const stored = loadStored();
  const useChatApi = stored?.useChatApi !== false;
  const model = stored?.model?.trim() || envEmbeddingModel();

  if (useChatApi) {
    const chat = loadModelConfig();
    return {
      apiKey: chat.apiKey,
      baseUrl: chat.baseUrl,
      model,
    };
  }

  const apiKey = stored?.apiKey || envEmbeddingKey();
  const baseUrl = stored?.baseUrl || envEmbeddingBaseUrl();

  if (!apiKey) {
    throw new Error(
      '未配置 Embedding API Key。请在 设置 → 泰提斯终端 → 向量 API 填写，或在 .env 设置 EMBEDDING_API_KEY',
    );
  }
  if (!baseUrl) {
    throw new Error(
      '未配置 Embedding 接入 URL。请在 设置 → 泰提斯终端 → 向量 API 填写，或在 .env 设置 EMBEDDING_BASE_URL',
    );
  }

  return {
    apiKey,
    baseUrl: normalizeBaseUrl(baseUrl),
    model,
  };
}

export function getEmbeddingConfigSafe(): EmbeddingApiConfig | null {
  try {
    return loadEmbeddingConfig();
  } catch {
    return null;
  }
}

export function getEmbeddingSettingsInfo(): EmbeddingSettingsInfo {
  const stored = loadStored();
  const useChatApi = stored?.useChatApi !== false;

  if (useChatApi) {
    const chat = getModelConfigSafe();
    const hasEnvFallback = Boolean(envEmbeddingKey() && envEmbeddingBaseUrl());
    return {
      useChatApi: true,
      baseUrl: chat?.baseUrl ?? envEmbeddingBaseUrl(),
      model: envEmbeddingModel(),
      apiKeyMasked: chat?.apiKey ? maskApiKey(chat.apiKey) : envEmbeddingKey() ? maskApiKey(envEmbeddingKey()) : '',
      apiKeyConfigured: Boolean(chat?.apiKey || envEmbeddingKey()),
      source: chat ? 'chat' : hasEnvFallback ? 'env' : 'chat',
    };
  }

  const apiKey = stored?.apiKey || envEmbeddingKey();
  const baseUrl = stored?.baseUrl || envEmbeddingBaseUrl();
  const model = stored?.model || envEmbeddingModel();
  const fromEnvOnly = !stored?.apiKey && !stored?.baseUrl && Boolean(envEmbeddingKey());

  return {
    useChatApi: false,
    baseUrl,
    model,
    apiKeyMasked: apiKey ? maskApiKey(apiKey) : '',
    apiKeyConfigured: apiKey.length > 0,
    source: fromEnvOnly ? 'env' : 'dedicated',
  };
}

export function saveEmbeddingSettings(patch: EmbeddingSettingsPatch): EmbeddingSettingsInfo {
  const current = loadStored() ?? {
    useChatApi: true,
    baseUrl: '',
    model: envEmbeddingModel(),
    apiKey: '',
  };

  if (patch.useChatApi !== undefined) {
    current.useChatApi = patch.useChatApi;
  }
  if (patch.baseUrl !== undefined) {
    current.baseUrl = normalizeBaseUrl(patch.baseUrl);
    if (!current.useChatApi) {
      validateEmbeddingBaseUrl(current.baseUrl);
    }
  }
  if (patch.model !== undefined) {
    current.model = patch.model.trim() || envEmbeddingModel();
  }
  if (patch.apiKey !== undefined && patch.apiKey.trim()) {
    current.apiKey = patch.apiKey.trim();
  }

  saveStored(current);
  return getEmbeddingSettingsInfo();
}
