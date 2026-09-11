import { ipcMain } from 'electron';
import {
  getPerformanceSettings,
  savePerformanceSettings,
  type PerformanceSettings,
} from '../../src/config/performance';
import type { PerformanceSettingsInfo } from '../../src/shared/types';
import { reloadScheduler } from '../scheduler/cron';

function toInfo(settings: PerformanceSettings): PerformanceSettingsInfo {
  return {
    ragEnabled: settings.ragEnabled,
    ragInjectMode: settings.ragInjectMode,
    ragMinScore: settings.ragMinScore,
    ragMaxChunksPerDoc: settings.ragMaxChunksPerDoc,
    ragNeighborWindow: settings.ragNeighborWindow,
    ragFtsFirst: settings.ragFtsFirst,
    ragDocRouteTopK: settings.ragDocRouteTopK,
    ragDocRouteMinDocs: settings.ragDocRouteMinDocs,
    ragRerankEnabled: settings.ragRerankEnabled,
    ragRerankTopK: settings.ragRerankTopK,
    ragHydeEnabled: settings.ragHydeEnabled,
    memoryExtractMode: settings.memoryExtractMode,
    memoryExtractInterval: settings.memoryExtractInterval,
    maxHistoryMessages: settings.maxHistoryMessages,
    compressThreshold: settings.compressThreshold,
    contextMaxInputTokens: settings.contextMaxInputTokens,
    memorySemanticInContext: settings.memorySemanticInContext,
    proactivityEnabled: settings.proactivityEnabled,
    quietHoursStart: settings.quietHoursStart,
    quietHoursEnd: settings.quietHoursEnd,
    notificationDedupMinutes: settings.notificationDedupMinutes,
  };
}

export function registerPerformanceIpc(): void {
  ipcMain.handle('performance:get', (): PerformanceSettingsInfo => {
    return toInfo(getPerformanceSettings());
  });

  ipcMain.handle(
    'performance:set',
    (_event, patch: Partial<PerformanceSettingsInfo>): PerformanceSettingsInfo => {
      const saved = savePerformanceSettings(patch);
      if (
        patch.proactivityEnabled != null ||
        patch.quietHoursStart != null ||
        patch.quietHoursEnd != null ||
        patch.notificationDedupMinutes != null
      ) {
        reloadScheduler();
      }
      return toInfo(saved);
    },
  );
}
