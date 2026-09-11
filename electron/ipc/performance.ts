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
