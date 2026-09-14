/**
 * 录音转写（腾讯云极速版）的凭证与参数解析。
 *
 * **刻意与百炼凭证完全分离**：对话模型走百炼、转写走腾讯云，是两套凭证、
 * 两种鉴权方式。绝不复用 `resolveVoiceApiKey()`——它返回单个字符串，装不下
 * 一对凭证，而且它的回落链会拿到百炼的 key，用在腾讯云上只会得到一个
 * 难懂的鉴权错误。也不得把这些绑到 `modelConfig`：用户换对话模型时，
 * 转写不该受影响。
 *
 * 解析顺序与现有 TTS 端点一致：应用内设置 → `.env` → 默认。
 * SecretId / SecretKey 以系统凭据存储加密后落库（与百炼 Key 同一做法），
 * 设置页只拿到掩码，绝不回传明文。
 */
import { deleteSetting, getSetting, setSetting } from '../db/app-settings';
import { isProtectedSecret, protectSecret, revealSecret } from '../security/secret-storage';
import type { AsrSettingsInfo, AsrSettingsPatch } from '../shared/types';
import { DEFAULT_ASR_ENGINE, type AsrEngineType, ASR_ENGINE_TYPES } from '../voice/asr-contract';

export const ASR_SETTING_KEYS = {
  secretId: 'asr.tencent.secretId',
  secretKey: 'asr.tencent.secretKey',
  appId: 'asr.tencent.appId',
  engineType: 'asr.tencent.engineType',
  diarization: 'asr.tencent.diarization',
} as const;

export interface AsrCredentials {
  secretId: string;
  secretKey: string;
  appId: string;
}

export interface AsrSettings extends AsrCredentials {
  engineType: AsrEngineType;
  diarization: boolean;
}

function fromSetting(key: string): string {
  try {
    const raw = getSetting(key)?.trim() ?? '';
    return isProtectedSecret(raw) ? revealSecret(raw) : raw;
  } catch {
    // 数据库未初始化时（脚本、测试）退回环境变量，不让配置读取本身成为故障点
    return '';
  }
}

function fromEnv(name: string): string {
  return process.env[name]?.trim() ?? '';
}

function resolveValue(settingKey: string, envName: string): string {
  return fromSetting(settingKey) || fromEnv(envName);
}

function parseEngineType(raw: string): AsrEngineType {
  return (ASR_ENGINE_TYPES as readonly string[]).includes(raw) ? (raw as AsrEngineType) : DEFAULT_ASR_ENGINE;
}

function parseDiarization(raw: string): boolean {
  // 默认开启：会议纪要几乎总需要区分发言人。显式写 0/false 才关闭。
  return raw ? !['0', 'false', 'off', 'no'].includes(raw.toLowerCase()) : true;
}

export function resolveAsrSettings(): AsrSettings {
  return {
    secretId: resolveValue(ASR_SETTING_KEYS.secretId, 'TENCENT_ASR_SECRET_ID'),
    secretKey: resolveValue(ASR_SETTING_KEYS.secretKey, 'TENCENT_ASR_SECRET_KEY'),
    appId: resolveValue(ASR_SETTING_KEYS.appId, 'TENCENT_ASR_APP_ID'),
    engineType: parseEngineType(resolveValue(ASR_SETTING_KEYS.engineType, 'TENCENT_ASR_ENGINE_TYPE')),
    diarization: parseDiarization(resolveValue(ASR_SETTING_KEYS.diarization, 'TENCENT_ASR_DIARIZATION')),
  };
}

export type AsrConfigStatus =
  | { configured: true; credentials: AsrCredentials }
  | { configured: false; missing: string[]; reason: string };

const APP_ID_PATTERN = /^\d+$/;
const APP_ID_HINT = 'AppID 应为纯数字，可在腾讯云控制台「账号信息」页查看；注意它与同为数字的“账号ID”不是一个值';

/**
 * 凭证是否齐备。**缺失时要指名道姓地说缺哪个**——
 * 三个值里少任何一个，服务端给的都是同一个笼统的鉴权失败。
 */
export function checkAsrConfig(settings: AsrSettings = resolveAsrSettings()): AsrConfigStatus {
  const missing: string[] = [];
  if (!settings.secretId) missing.push('SecretId');
  if (!settings.secretKey) missing.push('SecretKey');
  if (!settings.appId) missing.push('AppID');
  if (missing.length) {
    return {
      configured: false,
      missing,
      reason: `录音转写尚未配置：缺少 ${missing.join(' / ')}。请在「设置 → 语音 → 录音转写」中填写腾讯云语音识别凭证`,
    };
  }
  if (!APP_ID_PATTERN.test(settings.appId)) {
    return { configured: false, missing: ['AppID'], reason: APP_ID_HINT };
  }
  return {
    configured: true,
    credentials: { secretId: settings.secretId, secretKey: settings.secretKey, appId: settings.appId },
  };
}

/** 掩码显示，供设置页回显；绝不回传明文。 */
export function maskSecret(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 8) return '*'.repeat(trimmed.length);
  return `${trimmed.slice(0, 4)}${'*'.repeat(Math.min(12, trimmed.length - 8))}${trimmed.slice(-4)}`;
}

function hasStoredCredential(): boolean {
  return Boolean(
    fromSetting(ASR_SETTING_KEYS.secretId) ||
      fromSetting(ASR_SETTING_KEYS.secretKey) ||
      fromSetting(ASR_SETTING_KEYS.appId),
  );
}

/** 设置页看到的状态：掩码、来源与是否可用。不含任何明文密钥。 */
export function getAsrSettingsInfo(): AsrSettingsInfo {
  const settings = resolveAsrSettings();
  const status = checkAsrConfig(settings);
  const anyValue = Boolean(settings.secretId || settings.secretKey || settings.appId);
  return {
    secretIdMasked: maskSecret(settings.secretId),
    secretKeyMasked: maskSecret(settings.secretKey),
    appId: settings.appId,
    engineType: settings.engineType,
    diarization: settings.diarization,
    configured: status.configured,
    reason: status.configured ? null : status.reason,
    credentialsSource: !anyValue ? 'none' : hasStoredCredential() ? 'settings' : 'env',
  };
}

/**
 * 保存设置。凭证字段留空表示"不修改"（与百炼 Key 的约定一致），
 * `clearCredentials` 才会删掉应用内保存的三个凭证，之后回落到环境变量。
 */
export function saveAsrSettings(patch: AsrSettingsPatch): AsrSettingsInfo {
  if (patch.clearCredentials) {
    deleteSetting(ASR_SETTING_KEYS.secretId);
    deleteSetting(ASR_SETTING_KEYS.secretKey);
    deleteSetting(ASR_SETTING_KEYS.appId);
  }

  const secretId = patch.secretId?.trim();
  if (secretId) setSetting(ASR_SETTING_KEYS.secretId, protectSecret(secretId));

  const secretKey = patch.secretKey?.trim();
  if (secretKey) setSetting(ASR_SETTING_KEYS.secretKey, protectSecret(secretKey));

  const appId = patch.appId?.trim();
  if (appId) {
    if (!APP_ID_PATTERN.test(appId)) throw new Error(APP_ID_HINT);
    setSetting(ASR_SETTING_KEYS.appId, appId);
  }

  if (patch.engineType !== undefined) {
    if (!(ASR_ENGINE_TYPES as readonly string[]).includes(patch.engineType)) {
      throw new Error(`不支持的引擎类型：${String(patch.engineType)}`);
    }
    setSetting(ASR_SETTING_KEYS.engineType, patch.engineType);
  }

  if (patch.diarization !== undefined) {
    setSetting(ASR_SETTING_KEYS.diarization, patch.diarization ? '1' : '0');
  }

  return getAsrSettingsInfo();
}
