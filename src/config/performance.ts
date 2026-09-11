import { getSetting, setSetting } from '../db/app-settings';
import { DEFAULT_CONTEXT_MAX_INPUT_TOKENS } from '../agent/context-budget';

export type MemoryExtractMode = 'always' | 'manual' | 'every_n';

/** auto: 知识问答时自动注入片段；catalog: 仅注入文档目录；tool: 完全不自动检索，靠 search_knowledge */
export type RagInjectMode = 'auto' | 'catalog' | 'tool';

export interface PerformanceSettings {
  ragEnabled: boolean;
  ragInjectMode: RagInjectMode;
  ragMinScore: number;
  ragMaxChunksPerDoc: number;
  ragArchiveDedupeThreshold: number;
  ragNeighborWindow: number;
  ragFtsFirst: boolean;
  ragDocRouteTopK: number;
  ragDocRouteMinDocs: number;
  ragRerankEnabled: boolean;
  ragRerankTopK: number;
  ragHydeEnabled: boolean;
  memoryExtractMode: MemoryExtractMode;
  memoryExtractInterval: number;
  maxHistoryMessages: number;
  compressThreshold: number;
  contextMaxInputTokens: number;
  memorySemanticInContext: boolean;
  proactivityEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  notificationDedupMinutes: number;
}

export { DEFAULT_CONTEXT_MAX_INPUT_TOKENS } from '../agent/context-budget';

const DEFAULTS: PerformanceSettings = {
  ragEnabled: true,
  ragInjectMode: 'catalog',
  ragMinScore: 0.35,
  ragMaxChunksPerDoc: 2,
  ragArchiveDedupeThreshold: 0.92,
  ragNeighborWindow: 1,
  ragFtsFirst: true,
  ragDocRouteTopK: 3,
  ragDocRouteMinDocs: 4,
  ragRerankEnabled: false,
  ragRerankTopK: 15,
  ragHydeEnabled: false,
  memoryExtractMode: 'always',
  memoryExtractInterval: 3,
  maxHistoryMessages: 20,
  compressThreshold: 30,
  contextMaxInputTokens: DEFAULT_CONTEXT_MAX_INPUT_TOKENS,
  memorySemanticInContext: true,
  proactivityEnabled: true,
  quietHoursStart: '',
  quietHoursEnd: '',
  notificationDedupMinutes: 5,
};

function envBool(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw == null || raw === '') return fallback;
  return raw === '1' || raw.toLowerCase() === 'true';
}

function envIntNonNegative(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw == null || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw == null || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function envFloat(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw == null || raw === '') return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeContextMaxInputTokens(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CONTEXT_MAX_INPUT_TOKENS;
  return Math.max(8000, Math.min(120_000, Math.floor(value)));
}

function normalizeInteger(
  value: number,
  min: number,
  max: number,
  fallback: number,
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function parseMemoryExtractMode(raw: string | null): MemoryExtractMode {
  if (raw === 'manual' || raw === 'every_n' || raw === 'always') return raw;
  return DEFAULTS.memoryExtractMode;
}

function parseRagInjectMode(raw: string | null): RagInjectMode {
  if (raw === 'auto' || raw === 'catalog' || raw === 'tool') return raw;
  return DEFAULTS.ragInjectMode;
}

function normalizeClock(raw: string | null | undefined, fallback = ''): string {
  if (!raw) return fallback;
  const match = raw.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return fallback;
  return `${String(hour).padStart(2, '0')}:${match[2]}`;
}

export function getPerformanceSettings(): PerformanceSettings {
  return {
    ragEnabled: getSetting('RAG_ENABLED') != null
      ? getSetting('RAG_ENABLED') === 'true'
      : envBool('RAG_ENABLED', DEFAULTS.ragEnabled),
    ragInjectMode: getSetting('RAG_INJECT_MODE') != null
      ? parseRagInjectMode(getSetting('RAG_INJECT_MODE'))
      : (process.env.RAG_INJECT_MODE as RagInjectMode | undefined) &&
          ['auto', 'catalog', 'tool'].includes(process.env.RAG_INJECT_MODE!)
        ? (process.env.RAG_INJECT_MODE as RagInjectMode)
        : DEFAULTS.ragInjectMode,
    ragMinScore: getSetting('RAG_MIN_SCORE') != null
      ? Number.parseFloat(getSetting('RAG_MIN_SCORE')!) || DEFAULTS.ragMinScore
      : envFloat('RAG_MIN_SCORE', DEFAULTS.ragMinScore),
    ragMaxChunksPerDoc: getSetting('RAG_MAX_CHUNKS_PER_DOC') != null
      ? Number.parseInt(getSetting('RAG_MAX_CHUNKS_PER_DOC')!, 10) ||
        DEFAULTS.ragMaxChunksPerDoc
      : envInt('RAG_MAX_CHUNKS_PER_DOC', DEFAULTS.ragMaxChunksPerDoc),
    ragArchiveDedupeThreshold: getSetting('RAG_ARCHIVE_DEDUPE_THRESHOLD') != null
      ? Number.parseFloat(getSetting('RAG_ARCHIVE_DEDUPE_THRESHOLD')!) ||
        DEFAULTS.ragArchiveDedupeThreshold
      : envFloat('RAG_ARCHIVE_DEDUPE_THRESHOLD', DEFAULTS.ragArchiveDedupeThreshold),
    ragNeighborWindow: (() => {
      const raw = getSetting('RAG_NEIGHBOR_WINDOW');
      if (raw != null) {
        const n = Number.parseInt(raw, 10);
        if (Number.isFinite(n) && n >= 0) return n;
      }
      return envIntNonNegative('RAG_NEIGHBOR_WINDOW', DEFAULTS.ragNeighborWindow);
    })(),
    ragFtsFirst: getSetting('RAG_FTS_FIRST') != null
      ? getSetting('RAG_FTS_FIRST') === 'true'
      : envBool('RAG_FTS_FIRST', DEFAULTS.ragFtsFirst),
    ragDocRouteTopK: getSetting('RAG_DOC_ROUTE_TOP_K') != null
      ? Number.parseInt(getSetting('RAG_DOC_ROUTE_TOP_K')!, 10) || DEFAULTS.ragDocRouteTopK
      : envInt('RAG_DOC_ROUTE_TOP_K', DEFAULTS.ragDocRouteTopK),
    ragDocRouteMinDocs: getSetting('RAG_DOC_ROUTE_MIN_DOCS') != null
      ? Number.parseInt(getSetting('RAG_DOC_ROUTE_MIN_DOCS')!, 10) || DEFAULTS.ragDocRouteMinDocs
      : envInt('RAG_DOC_ROUTE_MIN_DOCS', DEFAULTS.ragDocRouteMinDocs),
    ragRerankEnabled: getSetting('RAG_RERANK_ENABLED') != null
      ? getSetting('RAG_RERANK_ENABLED') === 'true'
      : envBool('RAG_RERANK_ENABLED', DEFAULTS.ragRerankEnabled),
    ragRerankTopK: getSetting('RAG_RERANK_TOP_K') != null
      ? Number.parseInt(getSetting('RAG_RERANK_TOP_K')!, 10) || DEFAULTS.ragRerankTopK
      : envInt('RAG_RERANK_TOP_K', DEFAULTS.ragRerankTopK),
    ragHydeEnabled: getSetting('RAG_HYDE_ENABLED') != null
      ? getSetting('RAG_HYDE_ENABLED') === 'true'
      : envBool('RAG_HYDE_ENABLED', DEFAULTS.ragHydeEnabled),
    memoryExtractMode: getSetting('AUTO_MEMORY_EXTRACT') != null
      ? parseMemoryExtractMode(getSetting('AUTO_MEMORY_EXTRACT'))
      : envBool('AUTO_MEMORY_EXTRACT', true)
        ? 'always'
        : 'manual',
    memoryExtractInterval: normalizeInteger(
      getSetting('MEMORY_EXTRACT_INTERVAL') != null
        ? Number.parseInt(getSetting('MEMORY_EXTRACT_INTERVAL')!, 10)
        : envInt('MEMORY_EXTRACT_INTERVAL', DEFAULTS.memoryExtractInterval),
      1,
      100,
      DEFAULTS.memoryExtractInterval,
    ),
    maxHistoryMessages: normalizeInteger(
      getSetting('MAX_HISTORY_MESSAGES') != null
        ? Number.parseInt(getSetting('MAX_HISTORY_MESSAGES')!, 10)
        : envInt('MAX_HISTORY_MESSAGES', DEFAULTS.maxHistoryMessages),
      6,
      60,
      DEFAULTS.maxHistoryMessages,
    ),
    compressThreshold: normalizeInteger(
      getSetting('COMPRESS_THRESHOLD') != null
        ? Number.parseInt(getSetting('COMPRESS_THRESHOLD')!, 10)
        : envInt('COMPRESS_THRESHOLD', DEFAULTS.compressThreshold),
      20,
      200,
      DEFAULTS.compressThreshold,
    ),
    contextMaxInputTokens: normalizeContextMaxInputTokens(
      getSetting('CONTEXT_MAX_INPUT_TOKENS') != null
        ? Number.parseInt(getSetting('CONTEXT_MAX_INPUT_TOKENS')!, 10)
        : envInt('CONTEXT_MAX_INPUT_TOKENS', DEFAULTS.contextMaxInputTokens),
    ),
    memorySemanticInContext: getSetting('MEMORY_SEMANTIC_IN_CONTEXT') != null
      ? getSetting('MEMORY_SEMANTIC_IN_CONTEXT') === 'true'
      : envBool('MEMORY_SEMANTIC_IN_CONTEXT', DEFAULTS.memorySemanticInContext),
    proactivityEnabled: getSetting('PROACTIVITY_ENABLED') != null
      ? getSetting('PROACTIVITY_ENABLED') === 'true'
      : envBool('PROACTIVITY_ENABLED', DEFAULTS.proactivityEnabled),
    quietHoursStart: normalizeClock(
      getSetting('PROACTIVITY_QUIET_START') ?? process.env.PROACTIVITY_QUIET_START,
      DEFAULTS.quietHoursStart,
    ),
    quietHoursEnd: normalizeClock(
      getSetting('PROACTIVITY_QUIET_END') ?? process.env.PROACTIVITY_QUIET_END,
      DEFAULTS.quietHoursEnd,
    ),
    notificationDedupMinutes: normalizeInteger(
      getSetting('PROACTIVITY_DEDUP_MINUTES') != null
        ? Number.parseInt(getSetting('PROACTIVITY_DEDUP_MINUTES')!, 10)
        : envIntNonNegative('PROACTIVITY_DEDUP_MINUTES', DEFAULTS.notificationDedupMinutes),
      0,
      1440,
      DEFAULTS.notificationDedupMinutes,
    ),
  };
}

export function savePerformanceSettings(patch: Partial<PerformanceSettings>): PerformanceSettings {
  if (patch.ragEnabled != null) setSetting('RAG_ENABLED', String(patch.ragEnabled));
  if (patch.ragInjectMode != null) setSetting('RAG_INJECT_MODE', patch.ragInjectMode);
  if (patch.ragMinScore != null) setSetting('RAG_MIN_SCORE', String(patch.ragMinScore));
  if (patch.ragMaxChunksPerDoc != null) {
    setSetting('RAG_MAX_CHUNKS_PER_DOC', String(patch.ragMaxChunksPerDoc));
  }
  if (patch.ragArchiveDedupeThreshold != null) {
    setSetting('RAG_ARCHIVE_DEDUPE_THRESHOLD', String(patch.ragArchiveDedupeThreshold));
  }
  if (patch.ragNeighborWindow != null) {
    setSetting('RAG_NEIGHBOR_WINDOW', String(patch.ragNeighborWindow));
  }
  if (patch.ragFtsFirst != null) setSetting('RAG_FTS_FIRST', String(patch.ragFtsFirst));
  if (patch.ragDocRouteTopK != null) {
    setSetting('RAG_DOC_ROUTE_TOP_K', String(patch.ragDocRouteTopK));
  }
  if (patch.ragDocRouteMinDocs != null) {
    setSetting('RAG_DOC_ROUTE_MIN_DOCS', String(patch.ragDocRouteMinDocs));
  }
  if (patch.ragRerankEnabled != null) {
    setSetting('RAG_RERANK_ENABLED', String(patch.ragRerankEnabled));
  }
  if (patch.ragRerankTopK != null) setSetting('RAG_RERANK_TOP_K', String(patch.ragRerankTopK));
  if (patch.ragHydeEnabled != null) setSetting('RAG_HYDE_ENABLED', String(patch.ragHydeEnabled));
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
  if (patch.contextMaxInputTokens != null) {
    setSetting('CONTEXT_MAX_INPUT_TOKENS', String(patch.contextMaxInputTokens));
  }
  if (patch.memorySemanticInContext != null) {
    setSetting('MEMORY_SEMANTIC_IN_CONTEXT', String(patch.memorySemanticInContext));
  }
  if (patch.proactivityEnabled != null) {
    setSetting('PROACTIVITY_ENABLED', String(patch.proactivityEnabled));
  }
  if (patch.quietHoursStart != null) {
    setSetting('PROACTIVITY_QUIET_START', normalizeClock(patch.quietHoursStart));
  }
  if (patch.quietHoursEnd != null) {
    setSetting('PROACTIVITY_QUIET_END', normalizeClock(patch.quietHoursEnd));
  }
  if (patch.notificationDedupMinutes != null) {
    setSetting('PROACTIVITY_DEDUP_MINUTES', String(patch.notificationDedupMinutes));
  }

  return getPerformanceSettings();
}

const CASUAL_PATTERNS = [
  /^(你好|嗨|hi|hello|在吗|谢谢|感谢|好的|ok|okay|嗯|哦|哈哈|再见|拜拜)[!.?~]*$/i,
  /^[\p{Emoji}\s]+$/u,
];

/** 纯寒暄时不自动注入 RAG，避免每句「你好」都走向量检索 */
export function isCasualChat(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return true;
  return CASUAL_PATTERNS.some((p) => p.test(trimmed));
}

export function looksLikeKnowledgeQuery(query: string, filenames: string[] = []): boolean {
  const trimmed = query.trim();
  if (isCasualChat(trimmed)) return false;

  if (/[?？]/.test(trimmed)) return true;
  if (/(吗|什么|如何|怎么|哪|谁|为何|为什么|多少|是否)/.test(trimmed)) return true;

  const lower = trimmed.toLowerCase();
  if (
    filenames.some((name) => {
      const base = name.replace(/\.[^.]+$/, '');
      return lower.includes(name.toLowerCase()) || lower.includes(base.toLowerCase());
    })
  ) {
    return true;
  }

  if (trimmed.length >= 8 && !/^[\p{Emoji}\s]+$/u.test(trimmed)) return true;

  return false;
}

export function shouldInjectRagCatalog(
  hasDocuments: boolean,
  settings: PerformanceSettings = getPerformanceSettings(),
): boolean {
  if (!settings.ragEnabled) return false;
  if (!hasDocuments) return false;
  return settings.ragInjectMode !== 'tool';
}

export function shouldAutoRetrieveRag(
  query: string,
  hasDocuments: boolean,
  filenames: string[] = [],
  settings: PerformanceSettings = getPerformanceSettings(),
): boolean {
  if (!settings.ragEnabled) return false;
  if (!hasDocuments) return false;
  if (settings.ragInjectMode !== 'auto') return false;
  return looksLikeKnowledgeQuery(query, filenames);
}

/** @deprecated 使用 shouldInjectRagCatalog / shouldAutoRetrieveRag */
export function shouldRunRag(
  query: string,
  hasDocuments: boolean,
  settings: PerformanceSettings = getPerformanceSettings(),
): boolean {
  return shouldAutoRetrieveRag(query, hasDocuments, [], settings);
}
