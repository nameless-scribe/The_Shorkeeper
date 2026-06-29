import { getSetting, setSetting } from '../db/app-settings';

export type MemoryExtractMode = 'always' | 'manual' | 'every_n';

export interface PerformanceSettings {
  ragEnabled: boolean;
  memoryExtractMode: MemoryExtractMode;
  memoryExtractInterval: number;
  maxHistoryMessages: number;
  compressThreshold: number;
}

const DEFAULTS: PerformanceSettings = {
  ragEnabled: true,
  memoryExtractMode: 'always',
  memoryExtractInterval: 3,
  maxHistoryMessages: 20,
  compressThreshold: 30,
};

function envBool(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw == null || raw === '') return fallback;
  return raw === '1' || raw.toLowerCase() === 'true';
}

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw == null || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseMemoryExtractMode(raw: string | null): MemoryExtractMode {
  if (raw === 'manual' || raw === 'every_n' || raw === 'always') return raw;
  return DEFAULTS.memoryExtractMode;
}

export function getPerformanceSettings(): PerformanceSettings {
  return {
    ragEnabled: getSetting('RAG_ENABLED') != null
      ? getSetting('RAG_ENABLED') === 'true'
      : envBool('RAG_ENABLED', DEFAULTS.ragEnabled),
    memoryExtractMode: getSetting('AUTO_MEMORY_EXTRACT') != null
      ? parseMemoryExtractMode(getSetting('AUTO_MEMORY_EXTRACT'))
      : envBool('AUTO_MEMORY_EXTRACT', true)
        ? 'always'
        : 'manual',
    memoryExtractInterval: getSetting('MEMORY_EXTRACT_INTERVAL') != null
      ? Number.parseInt(getSetting('MEMORY_EXTRACT_INTERVAL')!, 10) || DEFAULTS.memoryExtractInterval
      : envInt('MEMORY_EXTRACT_INTERVAL', DEFAULTS.memoryExtractInterval),
    maxHistoryMessages: getSetting('MAX_HISTORY_MESSAGES') != null
      ? Number.parseInt(getSetting('MAX_HISTORY_MESSAGES')!, 10) || DEFAULTS.maxHistoryMessages
      : envInt('MAX_HISTORY_MESSAGES', DEFAULTS.maxHistoryMessages),
    compressThreshold: getSetting('COMPRESS_THRESHOLD') != null
      ? Number.parseInt(getSetting('COMPRESS_THRESHOLD')!, 10) || DEFAULTS.compressThreshold
      : envInt('COMPRESS_THRESHOLD', DEFAULTS.compressThreshold),
  };
}

export function savePerformanceSettings(patch: Partial<PerformanceSettings>): PerformanceSettings {
  if (patch.ragEnabled != null) setSetting('RAG_ENABLED', String(patch.ragEnabled));
  if (patch.memoryExtractMode != null) setSetting('AUTO_MEMORY_EXTRACT', patch.memoryExtractMode);
  if (patch.memoryExtractInterval != null) {
    setSetting('MEMORY_EXTRACT_INTERVAL', String(patch.memoryExtractInterval));
  }
  if (patch.maxHistoryMessages != null) {
    setSetting('MAX_HISTORY_MESSAGES', String(patch.maxHistoryMessages));
  }
  if (patch.compressThreshold != null) {
    setSetting('COMPRESS_THRESHOLD', String(patch.compressThreshold));
  }

  return getPerformanceSettings();
}

const CASUAL_PATTERNS = [
  /^(你好|嗨|hi|hello|在吗|谢谢|感谢|好的|ok|okay|嗯|哦|哈哈|再见|拜拜)[!.?~]*$/i,
  /^[\p{Emoji}\s]+$/u,
];

const KNOWLEDGE_HINTS = [
  /[？?]/,
  /什么|怎么|如何|为什么|哪|谁|多少|是否|能否|介绍|解释|说明|总结|对比|区别|定义|含义/,
  /文档|资料|规定|流程|步骤|数据|报告|方案|政策|条款|标准/,
];

export function looksLikeKnowledgeQuery(query: string): boolean {
  const trimmed = query.trim();
  if (trimmed.length < 4) return false;
  if (CASUAL_PATTERNS.some((p) => p.test(trimmed))) return false;
  if (trimmed.length >= 24) return true;
  return KNOWLEDGE_HINTS.some((p) => p.test(trimmed));
}

export function shouldRunRag(
  query: string,
  hasDocuments: boolean,
  settings: PerformanceSettings = getPerformanceSettings(),
): boolean {
  if (!settings.ragEnabled) return false;
  if (!hasDocuments) return false;
  return looksLikeKnowledgeQuery(query);
}
