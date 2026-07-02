import type { OpenAIToolCall } from '../agent/types';

export type { AgUiEvent, AgentPresenceState, CallState } from '../agent/types';
export type { ToolResult } from '../tools/types';

export type ModelEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'reasoning_delta'; delta: string }
  | {
      type: 'usage';
      promptTokens: number;
      completionTokens: number;
      cachedTokens?: number;
    }
  | {
      type: 'round_complete';
      content: string | null;
      toolCalls: OpenAIToolCall[];
    }
  | { type: 'done' }
  | { type: 'error'; message: string };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface WorkspaceAttachment {
  relativePath: string;
  originalName: string;
  size: number;
}

export interface AgentSendPayload {
  sessionId?: string;
  message: string;
  attachments?: WorkspaceAttachment[];
}

export interface ModelConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export type ModelProtocol = 'openai' | 'anthropic';

export interface ModelProfileInfo {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  protocol: ModelProtocol;
  apiKeyMasked: string;
  apiKeyConfigured: boolean;
}

export interface ModelProfilesInfo {
  activeId: string | null;
  profiles: ModelProfileInfo[];
}

export interface ModelProfileInput {
  name: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  protocol?: ModelProtocol;
}

export interface ModelProfilePatch {
  name?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  protocol?: ModelProtocol;
}

export interface ModelSettingsInfo {
  profileId: string | null;
  name: string;
  apiKeyMasked: string;
  apiKeyConfigured: boolean;
  baseUrl: string;
  model: string;
  protocol: ModelProtocol;
  configuredInApp: boolean;
}

export interface ModelSettingsPatch {
  name?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  protocol?: ModelProtocol;
}

export type EmbeddingConfigSource = 'chat' | 'dedicated' | 'env';

export interface EmbeddingSettingsInfo {
  useChatApi: boolean;
  baseUrl: string;
  model: string;
  apiKeyMasked: string;
  apiKeyConfigured: boolean;
  source: EmbeddingConfigSource;
}

export interface EmbeddingSettingsPatch {
  useChatApi?: boolean;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}

export type WebSearchConfigSource = 'app' | 'env' | 'none';

export interface WebSearchSettingsInfo {
  apiKeyMasked: string;
  apiKeyConfigured: boolean;
  provider: 'bocha';
  source: WebSearchConfigSource;
}

export interface WebSearchSettingsPatch {
  apiKey?: string;
}

export interface McpServerInfo {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
}

export interface PerformanceSettingsInfo {
  ragEnabled: boolean;
  ragInjectMode: 'auto' | 'catalog' | 'tool';
  ragMinScore: number;
  ragMaxChunksPerDoc: number;
  memoryExtractMode: 'always' | 'manual' | 'every_n';
  memoryExtractInterval: number;
  maxHistoryMessages: number;
  compressThreshold: number;
  memorySemanticInContext: boolean;
}

export type FilesystemMode = 'readonly' | 'confirm' | 'full';

export interface PluginSettingsInfo {
  webSearch: boolean;
  fetchUrl: boolean;
  docGen: boolean;
  bookkeeping: boolean;
  lifeTools: boolean;
  filesystemMode: FilesystemMode;
  mcpEnabledCount: number;
}

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  systemPromptFragment: string;
  allowedTools?: string[];
  trigger: 'manual' | 'auto';
  enabled: boolean;
}

export interface SessionInfo {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  archived?: boolean;
  compressed?: boolean;
}

export interface SessionListOptions {
  includeArchived?: boolean;
  query?: string;
  limit?: number;
  offset?: number;
}

export interface SessionListResult {
  items: SessionInfo[];
  total: number;
  hasMore: boolean;
}

export interface SessionDeleteResult {
  ok: boolean;
  error?: string;
  busy?: boolean;
  /** 删除的是当前活跃会话时，自动创建的新会话 */
  replacementSession?: SessionInfo;
}

export interface DeleteEmptySessionsResult {
  deletedCount: number;
  deletedIds: string[];
  keptSessionId: string | null;
}

export interface MessageInfo {
  id: string;
  sessionId: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  createdAt: number;
}

export interface WorldbookEntryInfo {
  id: string;
  keys: string;
  content: string;
  priority: number;
  enabled: boolean;
  createdAt: number;
}

export interface ProfileEntryInfo {
  key: string;
  value: string;
  updatedAt: number;
}

export interface AppStatus {
  model: string;
  profileName: string | null;
  baseUrl: string;
  apiConfigured: boolean;
  databasePath: string;
}

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface UpdateInfo {
  status: UpdateStatus;
  version?: string;
  progress?: number;
  error?: string;
}

export interface DockPreferencesInfo {
  alwaysOnTop: boolean;
  positionLocked: boolean;
}

export interface TokenUsageSummaryInfo {
  today: number;
  week: number;
  total: number;
  todayCached: number;
  cacheHitRateToday: number;
  dailyLast7: { date: string; tokens: number; cached: number }[];
}

export type ScheduleKind = 'recurring' | 'once';

export interface ScheduledTaskInfo {
  id: string;
  name: string;
  scheduleKind: ScheduleKind;
  cron: string;
  runAt: number | null;
  actionType: string;
  actionPayload: string;
  enabled: boolean;
  lastRunAt: number | null;
}

export interface DocumentInfo {
  id: string;
  filename: string;
  filepath: string;
  mimeType: string | null;
  chunkCount: number;
  importedAt: number;
}

export type ImportProgress =
  | { phase: 'reading' }
  | { phase: 'chunking'; chunkCount: number }
  | { phase: 'embedding'; done: number; total: number }
  | { phase: 'done'; document: DocumentInfo }
  | { phase: 'skipped'; document: DocumentInfo; reason: string };

export type ReindexProgress = {
  done: number;
  total: number;
  filename?: string;
};

export interface PermissionRequestPayload {
  requestId: string;
  toolName: string;
  args: unknown;
}

export interface PersonaSettingsInfo {
  systemPrompt: string;
  version: string;
  displayName: string;
  isCustom: boolean;
  builtinVersion: string;
  charCount: number;
  updatedAt: number | null;
}

export interface PersonaSettingsPatch {
  systemPrompt?: string;
  displayName?: string;
}

export interface ThemeColorTokens {
  navyDeep: string;
  navy: string;
  ice: string;
  iceDeep: string;
  cyan: string;
  cyanDim: string;
  silver: string;
  silverLight: string;
}

export interface ThemePresetSummary {
  id: string;
  name: string;
  description?: string;
  /** 预设色板预览（主题卡片用） */
  swatchDeep: string;
  swatchAccent: string;
}

export interface AppearanceAssetUrls {
  backgroundUrl: string | null;
  keeperAvatarUrl: string;
  userAvatarUrl: string;
  builtinBackground: string;
  builtinKeeperAvatar: string;
  builtinUserAvatar: string;
}

export type BackgroundFitMode = 'cover' | 'contain';

export interface AppearanceSettingsInfo {
  presetId: string;
  presetName: string;
  presets: ThemePresetSummary[];
  colors: ThemeColorTokens;
  assets: AppearanceAssetUrls;
  veil: {
    chat: string;
    status: string;
  };
  hasCustomAssets: boolean;
  /** 背景图适应方式：cover 铺满窗口，contain 完整显示 */
  backgroundFit: BackgroundFitMode;
  veilOpacity: number;
  showStars: boolean;
}

export type AppearanceAssetSlot = 'background' | 'keeperAvatar' | 'userAvatar';

export type {
  CosyVoiceModel,
  PlaybackTarget,
  SttLanguage,
  SttModel,
  VoiceSettings,
  VoiceSource,
} from '../voice/types';

export interface VoiceSettingsInfo {
  ttsEnabled: boolean;
  ttsAutoPlay: boolean;
  ttsModel: import('../voice/types').CosyVoiceModel;
  ttsVoiceId: string;
  ttsVoiceSource: import('../voice/types').VoiceSource;
  activeClonedProfileId: string | null;
  ttsRate: number;
  ttsVolume: number;
  ttsPlaybackGain: number;
  ttsMaxChars: number;
  sttEnabled: boolean;
  sttLanguage: import('../voice/types').SttLanguage;
  sttModel: import('../voice/types').SttModel;
  pushToTalk: boolean;
  sttAutoSend: boolean;
  playbackTarget: import('../voice/types').PlaybackTarget;
  callMode: 'push_to_talk' | 'vad_auto';
  callSilenceMs: number;
  callAllowBargeIn: boolean;
  callPersistTranscript: boolean;
  useChatApi: boolean;
  voiceTtsEndpoint: string;
  apiKeyConfigured: boolean;
  voiceApiKeyMasked: string;
  voiceConfigured: boolean;
  /** Resolved CosyVoice HTTP endpoint (for troubleshooting). */
  ttsEndpoint: string;
}

export type VoiceSettingsPatch = Partial<
  Omit<
    VoiceSettingsInfo,
    'apiKeyConfigured' | 'voiceApiKeyMasked' | 'voiceConfigured' | 'ttsEndpoint'
  >
> & {
  voiceApiKey?: string;
};

export interface VoiceSynthesizePayload {
  text: string;
}

export interface VoiceSynthesizeChunkPayload {
  text: string;
}

export interface VoiceTranscribePayload {
  /** Raw PCM 16-bit little-endian mono samples. */
  audio: ArrayBuffer;
  /** Sample rate of the PCM data in Hz (e.g. 16000). */
  sampleRate: number;
  lang?: import('../voice/types').SttLanguage;
}

export type VoiceTranscribeResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

export interface VoiceCallStartPayload {
  sessionId?: string;
}

export type VoiceCallStartResult =
  | { ok: true; callId: string }
  | { ok: false; error: string };

export interface VoiceCallUserTextPayload {
  callId: string;
  text: string;
}

export interface VoiceCallSpeakingDonePayload {
  callId: string;
}

export interface VoiceCallEndPayload {
  callId: string;
}

export type VoiceCallSimpleResult = { ok: true } | { ok: false; error: string };

export type VoiceSynthesizeChunkResult =
  | { ok: true; audio: ArrayBuffer; mime: string }
  | { ok: false; error: string };

export type SpeechPlaybackStep =
  | { kind: 'pause'; durationMs: number }
  | { kind: 'audio'; audio: ArrayBuffer; mime: string };

export type VoiceSynthesizeResult =
  | { ok: true; steps: SpeechPlaybackStep[] }
  | { ok: false; error: string };
