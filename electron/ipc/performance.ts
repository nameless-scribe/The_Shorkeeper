import { ipcMain } from 'electron';
import {
  getPerformanceSettings,
  savePerformanceSettings,
  type PerformanceSettings,
} from '../../src/config/performance';
import type { PerformanceSettingsInfo } from '../../src/shared/types';

function toInfo(settings: PerformanceSettings): PerformanceSettingsInfo {
  return {
    ragEnabled: settings.ragEnabled,
    memoryExtractMode: settings.memoryExtractMode,
    memoryExtractInterval: settings.memoryExtractInterval,
    maxHistoryMessages: settings.maxHistoryMessages,
    compressThreshold: settings.compressThreshold,
  };
}

export function registerPerformanceIpc(): void {
  ipcMain.handle('performance:get', (): PerformanceSettingsInfo => {
    return toInfo(getPerformanceSettings());
  });

  ipcMain.handle(
    'performance:set',
    (_event, patch: Partial<PerformanceSettingsInfo>): PerformanceSettingsInfo => {
      return toInfo(savePerformanceSettings(patch));
    },
  );
}
