import type { ModelConfig } from '../shared/types';

export function loadModelConfig(): ModelConfig {
  const apiKey = process.env.OPENAI_API_KEY?.trim() ?? '';
  const baseUrl = (process.env.OPENAI_BASE_URL?.trim() || '').replace(/\/$/, '');
  const model = process.env.DEFAULT_MODEL?.trim() || 'qwen3.6-plus';

  if (!apiKey) {
    throw new Error(
      '未配置 OPENAI_API_KEY。请在项目根目录 .env 填入阿里云百炼 API Key（sk- 开头）',
    );
  }

  if (!baseUrl) {
    throw new Error(
      '未配置 OPENAI_BASE_URL。请在 .env 填入百炼 OpenAI 兼容接入点（/compatible-mode/v1）',
    );
  }

  return { apiKey, baseUrl, model };
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
