import { trustedIpcMain as ipcMain } from './trusted-ipc';
import {
  getPerformanceSettings,
  savePerformanceSettings,
  type PerformanceSettings,
} from '../../src/config/performance';
import type { PerformanceSettingsInfo } from '../../src/shared/types';
import { reloadScheduler } from '../scheduler/cron';
import {
  requireBoolean,
  requireEnum,
  requireFiniteNumber,
  requireRecord,
  requireString,
} from '../../src/shared/ipc-validation';
import { PROACTIVE_EVENT_DOMAINS } from '../../src/proactivity/contract';
import { onProactivitySettingsChanged } from '../proactivity/runtime';

function parsePerformancePatch(value: unknown): Partial<PerformanceSettingsInfo> {
  const input = requireRecord(value, '性能设置');
  const output: Partial<PerformanceSettingsInfo> = {};
  const booleanKeys = [
    'ragEnabled', 'ragFtsFirst', 'ragRerankEnabled', 'ragHydeEnabled',
    'memorySemanticInContext', 'proactivityEnabled', 'keepInboxHistoryWhenDisabled',
  ] as const;
  for (const key of booleanKeys) {
    if (input[key] !== undefined) output[key] = requireBoolean(input[key], key);
  }

  const numericRules = {
    ragMinScore: [0, 1],
    ragMaxChunksPerDoc: [1, 20],
    ragNeighborWindow: [0, 5],
    ragDocRouteTopK: [1, 50],
    ragDocRouteMinDocs: [1, 1_000],
    ragRerankTopK: [1, 100],
    memoryExtractInterval: [1, 100],
    maxHistoryMessages: [6, 60],
    compressThreshold: [20, 200],
    contextMaxInputTokens: [8_000, 120_000],
    notificationDedupMinutes: [0, 1_440],
    notifyHourlyLimit: [0, 60],
    notifyDailyLimit: [0, 500],
  } as const;
  for (const [key, [min, max]] of Object.entries(numericRules)) {
    if (input[key] !== undefined) {
      (output as Record<string, unknown>)[key] = requireFiniteNumber(input[key], key, { min, max });
    }
  }

  if (input.ragInjectMode !== undefined) {
    output.ragInjectMode = requireEnum(input.ragInjectMode, 'RAG 注入模式', ['auto', 'catalog', 'tool'] as const);
  }
  if (input.memoryExtractMode !== undefined) {
    output.memoryExtractMode = requireEnum(input.memoryExtractMode, '记忆提取模式', ['always', 'manual', 'every_n'] as const);
  }
  if (input.mutedEventDomains !== undefined) {
    if (!Array.isArray(input.mutedEventDomains) || input.mutedEventDomains.length > PROACTIVE_EVENT_DOMAINS.length) {
      throw new TypeError('mutedEventDomains必须是事件域数组');
    }
    output.mutedEventDomains = input.mutedEventDomains.map((item) =>
      requireEnum(item, '事件域', PROACTIVE_EVENT_DOMAINS),
    );
  }
  for (const key of ['quietHoursStart', 'quietHoursEnd'] as const) {
    if (input[key] !== undefined) {
      const clock = requireString(input[key], key, { allowEmpty: true, maxLength: 5 });
      if (clock && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clock)) {
        throw new TypeError(`${key}必须是 HH:mm`);
      }
      output[key] = clock;
    }
  }
  return output;
}

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
    notifyHourlyLimit: settings.notifyHourlyLimit,
    notifyDailyLimit: settings.notifyDailyLimit,
    mutedEventDomains: settings.mutedEventDomains,
    keepInboxHistoryWhenDisabled: settings.keepInboxHistoryWhenDisabled,
  };
}

export function registerPerformanceIpc(): void {
  ipcMain.handle('performance:get', (): PerformanceSettingsInfo => {
    return toInfo(getPerformanceSettings());
  });

  ipcMain.handle(
    'performance:set',
    (_event, patch: Partial<PerformanceSettingsInfo>): PerformanceSettingsInfo => {
      const normalizedPatch = parsePerformancePatch(patch);
      const saved = savePerformanceSettings(normalizedPatch);
      if (
        normalizedPatch.proactivityEnabled != null ||
        normalizedPatch.quietHoursStart != null ||
        normalizedPatch.quietHoursEnd != null ||
        normalizedPatch.notificationDedupMinutes != null
      ) {
        reloadScheduler();
      }
      if (
        normalizedPatch.proactivityEnabled != null ||
        normalizedPatch.quietHoursStart != null ||
        normalizedPatch.quietHoursEnd != null ||
        normalizedPatch.notifyHourlyLimit != null ||
        normalizedPatch.notifyDailyLimit != null ||
        normalizedPatch.mutedEventDomains != null ||
        normalizedPatch.keepInboxHistoryWhenDisabled != null
      ) {
        onProactivitySettingsChanged(saved);
      }
      return toInfo(saved);
    },
  );
}
