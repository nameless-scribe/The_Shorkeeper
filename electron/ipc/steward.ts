import { trustedIpcMain as ipcMain } from './trusted-ipc';
import {
  applyDailyStewardSchedule,
  getDailyStewardSettings,
  saveDailyStewardSettings,
} from '../../src/config/daily-steward';
import type { DailyStewardSettingsInfo } from '../../src/shared/types';
import { requireBoolean, requireRecord, requireString } from '../../src/shared/ipc-validation';

function parsePatch(value: unknown): Partial<DailyStewardSettingsInfo> {
  const input = requireRecord(value, '每日管家设置');
  return {
    enabled: input.enabled === undefined ? undefined : requireBoolean(input.enabled, 'enabled'),
    morningTime: input.morningTime === undefined
      ? undefined
      : requireString(input.morningTime, '早间时间', { maxLength: 10 }),
    eveningTime: input.eveningTime === undefined
      ? undefined
      : requireString(input.eveningTime, '晚间时间', { maxLength: 10 }),
    popup: input.popup === undefined ? undefined : requireBoolean(input.popup, 'popup'),
  };
}

export function registerStewardIpc(): void {
  ipcMain.handle('steward:get', (): DailyStewardSettingsInfo => getDailyStewardSettings());

  ipcMain.handle('steward:set', (_event, patch: unknown): DailyStewardSettingsInfo => {
    const saved = saveDailyStewardSettings(parsePatch(patch));
    applyDailyStewardSchedule(saved);
    return saved;
  });
}
