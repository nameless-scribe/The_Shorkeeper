/**
 * 视觉模型设置（P8.2，计划 §2.4、§4.1、§4.2）：
 * - "允许把图片发送到视觉模型"默认关，关着时工具明确拒绝；
 * - 模型 ID 默认 qwen3-vl-plus；
 * - 接入点与 Key 默认复用 设置 → API 设置 里的百炼配置，可单独指定（对话用了别家模型时必填）；
 * - 单张最大像素可调。解析顺序：应用内设置 → .env → 默认。
 */
import { deleteSetting, getSetting, setSetting } from '../db/app-settings';
import { isProtectedSecret, protectSecret, revealSecret } from '../security/secret-storage';
import { loadModelRuntimeConfig } from '../models/config';
import { maskSecret } from './asr';
import type { VisionSettingsInfo, VisionSettingsPatch } from '../shared/types';
import { DEFAULT_VISION_MODEL, MAX_IMAGE_PIXELS } from '../vision/contract';

export const VISION_SETTING_KEYS = {
  enabled: 'vision.enabled',
  model: 'vision.model',
  apiKey: 'vision.apiKey',
  baseUrl: 'vision.baseUrl',
  maxPixels: 'vision.maxPixels',
} as const;

export const MIN_VISION_PIXELS = 1_000_000;

function fromSetting(key: string): string {
  try {
    const raw = getSetting(key)?.trim() ?? '';
    return isProtectedSecret(raw) ? revealSecret(raw) : raw;
  } catch {
    return '';
  }
}

function fromEnv(name: string): string {
  return process.env[name]?.trim() ?? '';
}

export interface VisionSettings {
  enabled: boolean;
  model: string;
  /** 单独指定的接入点与 Key；空表示复用对话模型的 */
  ownBaseUrl: string;
  ownApiKey: string;
  maxPixels: number;
}

export function resolveVisionSettings(): VisionSettings {
  const enabledRaw = fromSetting(VISION_SETTING_KEYS.enabled) || fromEnv('VISION_ENABLED');
  const pixelsRaw = fromSetting(VISION_SETTING_KEYS.maxPixels) || fromEnv('VISION_MAX_PIXELS');
  const pixels = Number(pixelsRaw);
  return {
    enabled: ['1', 'true', 'on', 'yes'].includes(enabledRaw.toLowerCase()),
    model: fromSetting(VISION_SETTING_KEYS.model) || fromEnv('VISION_MODEL') || DEFAULT_VISION_MODEL,
    ownBaseUrl: fromSetting(VISION_SETTING_KEYS.baseUrl) || fromEnv('VISION_BASE_URL'),
    ownApiKey: fromSetting(VISION_SETTING_KEYS.apiKey) || fromEnv('VISION_API_KEY'),
    maxPixels: Number.isFinite(pixels) && pixels >= MIN_VISION_PIXELS ? Math.min(MAX_IMAGE_PIXELS, Math.floor(pixels)) : MAX_IMAGE_PIXELS,
  };
}

export type VisionConfigStatus =
  | { ok: true; endpoint: { baseUrl: string; apiKey: string; model: string }; credentialsSource: 'own' | 'shared'; maxPixels: number }
  | { ok: false; reason: string; disabled: boolean };

/** 工具调用前的门：开关关着 → 明确提示；凭证缺 → 说去哪里配 */
export function checkVisionConfig(settings: VisionSettings = resolveVisionSettings()): VisionConfigStatus {
  if (!settings.enabled) {
    return { ok: false, disabled: true, reason: '看图功能未开启：请到「设置 → 语音 → 看图（视觉模型）」打开"允许把图片发送到视觉模型"。未开启前图片不会发出' };
  }
  if (settings.ownBaseUrl && settings.ownApiKey) {
    return { ok: true, endpoint: { baseUrl: settings.ownBaseUrl, apiKey: settings.ownApiKey, model: settings.model }, credentialsSource: 'own', maxPixels: settings.maxPixels };
  }
  if (settings.ownBaseUrl !== '' || settings.ownApiKey !== '') {
    return { ok: false, disabled: false, reason: '视觉模型的接入点与 Key 要同时填，或者都留空复用对话模型的百炼配置' };
  }
  try {
    const shared = loadModelRuntimeConfig();
    if (shared.protocol !== 'openai') {
      return { ok: false, disabled: false, reason: '对话模型走的不是 OpenAI 兼容协议，看图要在「设置 → 语音 → 看图」单独填写百炼接入点与 Key' };
    }
    return { ok: true, endpoint: { baseUrl: shared.baseUrl, apiKey: shared.apiKey, model: settings.model }, credentialsSource: 'shared', maxPixels: settings.maxPixels };
  } catch {
    return { ok: false, disabled: false, reason: '没有可用的百炼接入点与 Key：在「设置 → API 设置」配置，或在「设置 → 语音 → 看图」单独填写' };
  }
}

export function getVisionSettingsInfo(): VisionSettingsInfo {
  const settings = resolveVisionSettings();
  const status = checkVisionConfig(settings);
  return {
    enabled: settings.enabled,
    model: settings.model,
    baseUrl: settings.ownBaseUrl,
    apiKeyMasked: maskSecret(settings.ownApiKey),
    maxPixels: settings.maxPixels,
    configured: status.ok,
    credentialsSource: status.ok ? status.credentialsSource : 'none',
    reason: status.ok ? null : status.reason,
  };
}

export function saveVisionSettings(patch: VisionSettingsPatch): VisionSettingsInfo {
  if (patch.clearCredentials) {
    deleteSetting(VISION_SETTING_KEYS.apiKey);
    deleteSetting(VISION_SETTING_KEYS.baseUrl);
  }
  if (patch.enabled !== undefined) setSetting(VISION_SETTING_KEYS.enabled, patch.enabled ? '1' : '0');
  if (patch.model !== undefined) {
    const model = patch.model.trim();
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(model)) throw new Error('模型 ID 只能含字母、数字、点、横线与下划线');
    setSetting(VISION_SETTING_KEYS.model, model);
  }
  if (patch.baseUrl !== undefined) {
    const baseUrl = patch.baseUrl.trim();
    if (baseUrl) {
      if (!/^https?:\/\//i.test(baseUrl)) throw new Error('接入点要以 http(s):// 开头');
      setSetting(VISION_SETTING_KEYS.baseUrl, baseUrl.replace(/\/+$/, ''));
    } else {
      deleteSetting(VISION_SETTING_KEYS.baseUrl);
    }
  }
  const apiKey = patch.apiKey?.trim();
  if (apiKey) setSetting(VISION_SETTING_KEYS.apiKey, protectSecret(apiKey));
  if (patch.maxPixels !== undefined) {
    const pixels = Math.floor(patch.maxPixels);
    if (!Number.isFinite(pixels) || pixels < MIN_VISION_PIXELS || pixels > MAX_IMAGE_PIXELS) {
      throw new Error(`单张最大像素须在 ${MIN_VISION_PIXELS} 到 ${MAX_IMAGE_PIXELS} 之间`);
    }
    setSetting(VISION_SETTING_KEYS.maxPixels, String(pixels));
  }
  return getVisionSettingsInfo();
}
