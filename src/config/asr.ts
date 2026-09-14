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
 * 设置存储尚未接入（P4.2 的 UI 步骤），当前只读环境变量。
 */
import { getSetting } from '../db/app-settings';
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
    return getSetting(key)?.trim() ?? '';
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

export function resolveAsrSettings(): AsrSettings {
  const engineRaw = resolveValue(ASR_SETTING_KEYS.engineType, 'TENCENT_ASR_ENGINE_TYPE');
  const engineType = (ASR_ENGINE_TYPES as readonly string[]).includes(engineRaw)
    ? (engineRaw as AsrEngineType)
    : DEFAULT_ASR_ENGINE;

  const diarizationRaw = resolveValue(ASR_SETTING_KEYS.diarization, 'TENCENT_ASR_DIARIZATION');

  return {
    secretId: resolveValue(ASR_SETTING_KEYS.secretId, 'TENCENT_ASR_SECRET_ID'),
    secretKey: resolveValue(ASR_SETTING_KEYS.secretKey, 'TENCENT_ASR_SECRET_KEY'),
    appId: resolveValue(ASR_SETTING_KEYS.appId, 'TENCENT_ASR_APP_ID'),
    engineType,
    // 默认开启：会议纪要几乎总需要区分发言人。显式写 0/false 才关闭。
    diarization: diarizationRaw ? !['0', 'false', 'off', 'no'].includes(diarizationRaw.toLowerCase()) : true,
  };
}

export type AsrConfigStatus =
  | { configured: true; credentials: AsrCredentials }
  | { configured: false; missing: string[]; reason: string };

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
      reason: `录音转写尚未配置：缺少 ${missing.join(' / ')}。请在「设置 → 语音」中填写腾讯云语音识别凭证`,
    };
  }
  if (!/^\d+$/.test(settings.appId)) {
    return {
      configured: false,
      missing: ['AppID'],
      reason: 'AppID 应为纯数字，可在腾讯云控制台「账号信息」页查看；注意它与同为数字的“账号ID”不是一个值',
    };
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
