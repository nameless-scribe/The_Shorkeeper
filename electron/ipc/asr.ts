import { trustedIpcMain as ipcMain } from './trusted-ipc';
import { getAsrSettingsInfo, saveAsrSettings } from '../../src/config/asr';
import type { AsrSettingsInfo, AsrSettingsPatch } from '../../src/shared/types';
import { requireEnum, requireRecord, requireString } from '../../src/shared/ipc-validation';
import { ASR_ENGINE_TYPES } from '../../src/voice/asr-contract';

function parseAsrSettingsPatch(raw: unknown): AsrSettingsPatch {
  const input = requireRecord(raw, '录音转写设置');
  const patch: AsrSettingsPatch = {};
  for (const key of ['secretId', 'secretKey', 'appId'] as const) {
    if (input[key] !== undefined) {
      patch[key] = requireString(input[key], key, { allowEmpty: true, maxLength: 1_000 });
    }
  }
  if (input.engineType !== undefined) {
    patch.engineType = requireEnum(input.engineType, 'engineType', ASR_ENGINE_TYPES);
  }
  if (input.diarization !== undefined) {
    if (typeof input.diarization !== 'boolean') throw new TypeError('diarization 必须是布尔值');
    patch.diarization = input.diarization;
  }
  if (input.clearCredentials !== undefined) {
    if (typeof input.clearCredentials !== 'boolean') throw new TypeError('clearCredentials 必须是布尔值');
    patch.clearCredentials = input.clearCredentials;
  }
  return patch;
}

/** 录音转写（腾讯云）凭证与参数。只回传掩码；明文只在主进程内使用。 */
export function registerAsrIpc(): void {
  ipcMain.handle('asr:getSettings', (): AsrSettingsInfo => getAsrSettingsInfo());
  ipcMain.handle(
    'asr:saveSettings',
    (_event, patch: unknown): AsrSettingsInfo => saveAsrSettings(parseAsrSettingsPatch(patch)),
  );
}
