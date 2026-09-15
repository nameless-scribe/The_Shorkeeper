import { trustedIpcMain as ipcMain } from './trusted-ipc';
import { getVisionSettingsInfo, saveVisionSettings } from '../../src/config/vision';
import type { VisionSettingsInfo, VisionSettingsPatch } from '../../src/shared/types';
import { requireBoolean, requireFiniteNumber, requireRecord, requireString } from '../../src/shared/ipc-validation';

function parseVisionSettingsPatch(raw: unknown): VisionSettingsPatch {
  const input = requireRecord(raw, '看图设置');
  const patch: VisionSettingsPatch = {};
  if (input.enabled !== undefined) patch.enabled = requireBoolean(input.enabled, 'enabled');
  if (input.model !== undefined) patch.model = requireString(input.model, 'model', { maxLength: 100 });
  if (input.baseUrl !== undefined) patch.baseUrl = requireString(input.baseUrl, 'baseUrl', { allowEmpty: true, maxLength: 2_048 });
  if (input.apiKey !== undefined) patch.apiKey = requireString(input.apiKey, 'apiKey', { allowEmpty: true, maxLength: 20_000 });
  if (input.maxPixels !== undefined) patch.maxPixels = Math.floor(requireFiniteNumber(input.maxPixels, 'maxPixels', { min: 1, max: 100_000_000 }));
  if (input.clearCredentials !== undefined) patch.clearCredentials = requireBoolean(input.clearCredentials, 'clearCredentials');
  return patch;
}

/** 看图（视觉模型）设置：开关、模型 ID、可选的独立接入点与 Key（只回传掩码）。 */
export function registerVisionIpc(): void {
  ipcMain.handle('vision:getSettings', (): VisionSettingsInfo => getVisionSettingsInfo());
  ipcMain.handle('vision:saveSettings', (_event, patch: unknown): VisionSettingsInfo => saveVisionSettings(parseVisionSettingsPatch(patch)));
}
