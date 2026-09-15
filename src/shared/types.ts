import type { OpenAIToolCall } from '../agent/types';

export type { AgUiEvent, AgentPresenceState, AgentPlanItem, AgentPlanItemStatus, CallState } from '../agent/types';
export type { ToolErrorCategory, ToolResult } from '../tools/types';

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

export type WorkspaceAttachmentKind = 'text' | 'office' | 'audio';

export interface WorkspaceAttachment {
  relativePath: string;
  originalName: string;
  size: number;
  /** 文本 / Office / 录音；缺省按扩展名推断。录音在上下文里只给路径，不读内容 */
  kind?: WorkspaceAttachmentKind;
  /** 工具产物的完成证据：写入后读回计算的内容摘要 */
  sha256?: string;
}

export type TaskRunKind = 'chat' | 'scheduled' | 'voice';

export type TaskRunPhase =
  | 'created'
  | 'running'
  | 'waiting_tool'
  | 'waiting_approval'
  /** P6.1：正在等用户回答 ask_user 的问题 */
  | 'waiting_user'
  | 'finalizing'
  | 'finished'
  | 'cancelled'
  | 'error'
  | 'interrupted';

export interface TaskRunInfo {
  id: string;
  sessionId: string;
  kind: TaskRunKind;
  triggerRef: string | null;
  phase: TaskRunPhase;
  terminalReason: string | null;
  errorSummary: string | null;
  modelId: string | null;
  assistantMessageId: string | null;
  stepCount: number;
  failedStepCount: number;
  startedAt: number;
  updatedAt: number;
  terminalAt: number | null;
  acknowledgedAt: number | null;
}

/** skipped：本轮内重复调用被合并，未实际执行。 */
export type TaskRunStepStatus =
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'skipped'
  | 'interrupted';

export interface TaskRunStepInfo {
  id: string;
  runId: string;
  callId: string;
  seq: number;
  toolName: string;
  status: TaskRunStepStatus;
  errorCategory: string | null;
  errorSummary: string | null;
  riskLevel: string | null;
  idempotent: boolean;
  startedAt: number;
  endedAt: number | null;
}

export interface ArtifactInfo {
  id: string;
  runId: string;
  stepId: string | null;
  sessionId: string;
  toolName: string;
  relativePath: string;
  originalName: string;
  size: number;
  sha256: string | null;
  createdAt: number;
}

export type ApprovalStatus =
  | 'pending'
  | 'approved'
  | 'denied'
  | 'expired'
  | 'cancelled'
  | 'interrupted';

/** error：确认流程本身出错（窗口不可用、IPC 失败），用户并未做出选择。 */
export type ApprovalDecider = 'user' | 'timeout' | 'abort' | 'window_closed' | 'startup' | 'error';

export interface ApprovalInfo {
  id: string;
  runId: string | null;
  sessionId: string | null;
  toolName: string;
  argsSummary: string;
  riskLevel: string;
  status: ApprovalStatus;
  decidedBy: ApprovalDecider | null;
  requestedAt: number;
  decidedAt: number | null;
}

export interface TaskRunDetail {
  run: TaskRunInfo;
  steps: TaskRunStepInfo[];
  artifacts: ArtifactInfo[];
  approvals: ApprovalInfo[];
  contextSources: TaskRunContextSourceInfo[];
}

export type ContextSourceType = 'memory' | 'document' | 'goal' | 'commitment';

export interface TaskRunContextSourceInfo {
  id: string;
  runId: string;
  sourceType: ContextSourceType;
  sourceId: string;
  sourceRef: string;
  label: string;
  /** 脱敏、限长后的审计摘要，不保存完整 prompt。 */
  summary: string | null;
  documentVersion: number | null;
  sourceUpdatedAt: number | null;
  createdAt: number;
}

export interface ContextSourceDetailInfo {
  sourceType: ContextSourceType;
  sourceId: string;
  sourceRef: string;
  title: string;
  content: string | null;
  meta: string | null;
  available: boolean;
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
  ragNeighborWindow: number;
  ragFtsFirst: boolean;
  ragDocRouteTopK: number;
  ragDocRouteMinDocs: number;
  ragRerankEnabled: boolean;
  ragRerankTopK: number;
  ragHydeEnabled: boolean;
  memoryExtractMode: 'always' | 'manual' | 'every_n';
  memoryExtractInterval: number;
  maxHistoryMessages: number;
  compressThreshold: number;
  contextMaxInputTokens: number;
  memorySemanticInContext: boolean;
  proactivityEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  notificationDedupMinutes: number;
  /** 每小时 / 每日即时弹窗上限；达到后紧急度不足的事件只进收件箱 */
  notifyHourlyLimit: number;
  notifyDailyLimit: number;
  /** 静音的事件域：仍写入收件箱，但不弹窗 */
  mutedEventDomains: ProactiveEventDomain[];
  /** 全局关闭主动服务后是否保留收件箱历史 */
  keepInboxHistoryWhenDisabled: boolean;
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
  requiredTools?: string[];
  conflictsWith?: string[];
  trigger: 'manual' | 'auto';
  matchKeywords?: string[];
  priority: number;
  kind: 'capability' | 'workflow' | 'internal';
  validationErrors: string[];
  enabled: boolean;
}

export type AssistantMode = 'focus' | 'organize' | 'review' | 'companion';

export interface SessionInfo {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  archived?: boolean;
  compressed?: boolean;
  assistantMode: AssistantMode;
}

export type MemoryCandidateCategory =
  | 'stable_preference'
  | 'relationship'
  | 'other';

export type MemoryCandidateDecision = 'silent' | 'confirm' | 'deny';
export type MemoryCandidateStatus = 'pending' | 'confirmed' | 'rejected';

export type PersonalMemoryType =
  | 'identity'
  | 'preference'
  | 'relationship'
  | 'event'
  | 'goal'
  | 'habit'
  | 'procedure'
  | 'other';

export type PersonalMemoryStatus =
  | 'active'
  | 'disputed'
  | 'superseded'
  | 'expired'
  | 'rejected';

export type MemorySensitivity = 'normal' | 'private' | 'sensitive';
export type MemoryModelUsePolicy = 'allow' | 'deny';
export type MemoryProposedAction = 'create' | 'replace' | 'merge' | 'ignore';
export type MemoryCandidateResolution = 'keep_original' | 'replace' | 'coexist';
export type MemorySourceType =
  | 'conversation'
  | 'user_edit'
  | 'document'
  | 'tool'
  | 'goal'
  | 'commitment'
  | 'legacy';

export type AssistantActionPolicy = 'silent' | 'notify' | 'confirm' | 'deny';

export interface MemoryCandidateInfo {
  id: string;
  memoryKey: string;
  content: string;
  category: MemoryCandidateCategory;
  confidence: number;
  reason: string;
  sourceSessionId: string | null;
  sourceMessageId: string | null;
  sourceRunId: string | null;
  memoryType: PersonalMemoryType;
  sensitivity: MemorySensitivity;
  modelUsePolicy: MemoryModelUsePolicy;
  validFrom: number | null;
  expiresAt: number | null;
  conflictsWithMemoryId: string | null;
  proposedAction: MemoryProposedAction;
  status: MemoryCandidateStatus;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryInfo {
  id: string;
  memoryKey: string | null;
  content: string;
  importance: number;
  sourceSessionId: string | null;
  memoryType: PersonalMemoryType;
  confidence: number;
  sensitivity: MemorySensitivity;
  modelUsePolicy: MemoryModelUsePolicy;
  status: PersonalMemoryStatus;
  validFrom: number;
  expiresAt: number | null;
  supersededBy: string | null;
  createdAt: number;
  updatedAt: number;
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
  /** P3：最近一次执行失败的摘要、时间与连续失败次数 */
  lastError?: string | null;
  lastErrorAt?: number | null;
  failureCount?: number;
}

export type UserTaskStatus = 'pending' | 'in_progress' | 'done' | 'cancelled';

export interface UserTaskInfo {
  id: string;
  title: string;
  status: UserTaskStatus;
  sourceFile: string | null;
  sourceRow: number | null;
  module: string | null;
  dueAt: string | null;
  notes: string | null;
  goalId: string | null;
  createdAt: number;
  updatedAt: number;
}

export type GoalStatus = 'active' | 'paused' | 'done' | 'dropped';

export interface GoalInfo {
  id: string;
  title: string;
  description: string | null;
  status: GoalStatus;
  priority: number;
  targetDate: string | null;
  createdAt: number;
  updatedAt: number;
  closedAt: number | null;
}

export interface GoalProgress {
  totalTasks: number;
  doneTasks: number;
  openCommitments: number;
}

export type CommitmentOwner = 'user' | 'assistant';

/** proposed：从对话中识别、尚未由用户确认；open：生效；missed：到期未完成，由晚间复盘标记。 */
export type CommitmentStatus = 'proposed' | 'open' | 'done' | 'missed' | 'cancelled';

export interface CommitmentInfo {
  id: string;
  goalId: string | null;
  title: string;
  owner: CommitmentOwner;
  status: CommitmentStatus;
  dueAt: number | null;
  promisedTo: string | null;
  sourceSessionId: string | null;
  sourceRunId: string | null;
  taskId: string | null;
  scheduledTaskId: string | null;
  evidenceRunId: string | null;
  evidenceArtifactId: string | null;
  lastFollowedUpAt: number | null;
  createdAt: number;
  updatedAt: number;
  closedAt: number | null;
}

export interface DailyStewardSettingsInfo {
  enabled: boolean;
  /** HH:MM 本地时间 */
  morningTime: string;
  eveningTime: string;
  /** 简报生成后是否弹一条标题提醒 */
  popup: boolean;
}

export type BriefingKind = 'morning' | 'evening';
export type BriefingStatus = 'generated' | 'delivered' | 'failed';

export interface BriefingInfo {
  id: string;
  briefDate: string;
  kind: BriefingKind;
  runId: string | null;
  status: BriefingStatus;
  summary: string | null;
  createdAt: number;
  updatedAt: number;
}

/* ---------- P3 本地主动服务 ---------- */

export type ProactiveEventDomain =
  | 'task'
  | 'commitment'
  | 'run'
  | 'schedule'
  | 'document'
  | 'memory'
  | 'goal';

export type ProactiveEventKind =
  | 'task_due_today'
  | 'task_overdue'
  | 'commitment_due_soon'
  | 'commitment_missed'
  | 'commitment_proposed'
  | 'commitment_unattended'
  | 'run_error'
  | 'run_interrupted'
  | 'schedule_failed'
  | 'schedule_missed'
  | 'document_changed'
  | 'document_missing'
  | 'document_sync_failed'
  | 'memory_conflict'
  | 'memory_sensitive'
  | 'memory_expiring'
  | 'goal_target_near'
  | 'goal_stalled';

export type ProactiveEventUrgency = 'low' | 'normal' | 'high';

/** open：待处理；snoozed：用户稍后处理；dismissed：用户忽略；resolved：来源已解决或用户标记完成。 */
export type ProactiveEventStatus = 'open' | 'snoozed' | 'dismissed' | 'resolved';

export type ProactivityRoute = 'inbox' | 'notify' | 'defer' | 'suppress';

export type ProactivityRouteReason =
  | 'notified'
  | 'inbox_default'
  | 'disabled'
  | 'quiet_hours'
  | 'repeated'
  | 'domain_muted'
  | 'budget_exhausted'
  | 'snoozed'
  | 'resolved'
  | 'dismissed'
  | 'expired'
  | 'low_urgency';

export type ProactivityFeedbackAction = 'opened' | 'accepted' | 'dismissed' | 'snoozed' | 'resolved';

export type ProactivityFeedbackReason =
  | 'not_relevant'
  | 'already_handled'
  | 'too_noisy'
  | 'later'
  | 'source_opened'
  | 'source_resolved'
  | 'bulk_clear';

export interface ProactiveEventInfo {
  id: string;
  domain: ProactiveEventDomain;
  kind: ProactiveEventKind;
  sourceType: string;
  sourceId: string;
  sourceRef: string | null;
  dedupeKey: string;
  sourceVersion: number;
  title: string;
  summary: string | null;
  urgency: ProactiveEventUrgency;
  status: ProactiveEventStatus;
  dueAt: number | null;
  occurredAt: number;
  expiresAt: number | null;
  snoozedUntil: number | null;
  resolvedAt: number | null;
  resolvedReason: string | null;
  readAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface ProactivityDecisionInfo {
  id: string;
  eventId: string | null;
  decisionKey: string;
  subjectKind: 'event' | 'scheduled_reminder' | 'steward_notice';
  subjectId: string;
  policy: AssistantActionPolicy;
  route: ProactivityRoute;
  reason: string;
  ruleVersion: string;
  evaluatedAt: number;
}

export type ProactivityDeliveryChannel = 'popup' | 'inbox';
export type ProactivityDeliveryStatus = 'planned' | 'sent' | 'failed' | 'cancelled';

export interface ProactivityDeliveryInfo {
  id: string;
  eventId: string | null;
  deliveryKey: string;
  subjectKind: 'event' | 'scheduled_reminder' | 'steward_notice';
  subjectId: string;
  channel: ProactivityDeliveryChannel;
  status: ProactivityDeliveryStatus;
  scheduledAt: number | null;
  sentAt: number | null;
  errorCategory: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ProactivityFeedbackInfo {
  id: string;
  eventId: string;
  action: ProactivityFeedbackAction;
  reasonCode: ProactivityFeedbackReason | null;
  createdAt: number;
}

/** 收件箱卡片：事件本体加上最近一次路由结果与投递状态，供 UI 说明"为什么出现、是否被延后"。 */
export interface ProactiveInboxItemInfo {
  event: ProactiveEventInfo;
  lastRoute: ProactivityRoute | null;
  lastRouteReason: string | null;
  deliveredAt: number | null;
  deferredUntil: number | null;
}

export type ProactiveInboxSection = 'attention' | 'later' | 'handled';

export interface ProactiveInboxSnapshot {
  attention: ProactiveInboxItemInfo[];
  later: ProactiveInboxItemInfo[];
  handled: ProactiveInboxItemInfo[];
  unreadCount: number;
  generatedAt: number;
}

/** 点击"处理"时的回链目标；渲染层据此打开待办、承诺、运行、文档或记忆入口。 */
export interface ProactiveSourceTarget {
  domain: ProactiveEventDomain;
  sourceType: string;
  sourceId: string;
  sourceRef: string | null;
  /** 建议在渲染层打开的设置页签或聊天 */
  open: 'userTodos' | 'tasks' | 'runs' | 'documents' | 'memory' | 'chat';
  /** 打开聊天时的建议输入，不会自动发送 */
  suggestedPrompt: string | null;
}

/** P4 录音转写记录（渲染层视图）。正文不在其中，只有产物路径。 */
export interface AudioTranscriptInfo {
  id: string;
  sourcePath: string;
  sourceHash: string;
  sizeBytes: number;
  durationMs: number | null;
  provider: string;
  engineType: string;
  diarization: boolean;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled';
  transcriptPath: string | null;
  sentenceCount: number | null;
  speakerCount: number | null;
  error: string | null;
  providerCode: number | null;
  providerRequestId: string | null;
  sensitivity: string;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export interface ProactivityMetricsInfo {
  since: number;
  until: number;
  eventsCreated: number;
  notified: number;
  inboxed: number;
  deferred: number;
  suppressed: number;
  duplicateDeliveriesBlocked: number;
  opened: number;
  accepted: number;
  dismissed: number;
  snoozed: number;
  resolvedBySource: number;
}

export type DocumentStatus =
  | 'importing'
  | 'indexed'
  | 'index_failed'
  | 'needs_rebuild'
  | 'superseded'
  | 'deleted';

export type DocumentSourceKind = 'snapshot' | 'local_file';
export type DocumentFreshnessStatus = 'snapshot' | 'unknown' | 'current' | 'changed' | 'missing';
export type DocumentSyncPolicy = 'manual' | 'auto';

export interface DocumentInfo {
  id: string;
  filename: string;
  filepath: string;
  mimeType: string | null;
  chunkCount: number;
  importedAt: number;
  status: DocumentStatus;
  statusError: string | null;
  updatedAt: number;
  indexedAt: number | null;
  deletedAt: number | null;
  sourcePath: string | null;
  title: string;
  titleKey: string;
  version: number;
  supersededBy: string | null;
  chunkSize: number;
  chunkOverlap: number;
  sourceKind: DocumentSourceKind;
  sourceModifiedAt: number | null;
  sourceSize: number | null;
  lastCheckedAt: number | null;
  freshnessStatus: DocumentFreshnessStatus;
  staleReason: string | null;
  syncPolicy: DocumentSyncPolicy;
}

export type ImportProgress =
  | { phase: 'reading' }
  | { phase: 'chunking'; chunkCount: number }
  | { phase: 'embedding'; done: number; total: number }
  | { phase: 'retrying'; done: number; total: number; attempt: number; maxAttempts: number; error: string }
  | { phase: 'done'; document: DocumentInfo }
  | { phase: 'skipped'; document: DocumentInfo; reason: string };

export type ReindexProgress = {
  done: number;
  total: number;
  filename?: string;
  failed?: number;
};

export interface ReindexResult {
  indexed: number;
  failed: number;
}

export interface KnowledgeIndexCompatibilityInfo {
  storedDimensions: number[];
  storedModels: string[];
  storedChunkConfigs: Array<{ size: number; overlap: number }>;
  hasMismatch: boolean;
  modelMismatch: boolean;
  dimensionMismatch: boolean;
  chunkConfigMismatch: boolean;
}

export interface ToolPreviewChange {
  label: string;
  before: string;
  after: string;
}

/** 用户确认前展示的无副作用工具预览；revision 仅用于确认后防止执行过期预览。 */
export interface ToolPreviewInfo {
  kind: 'text-diff' | 'cell-changes';
  target: string;
  summary: string;
  revision: string;
  details?: string[];
  before?: string;
  after?: string;
  beforeTruncated?: boolean;
  afterTruncated?: boolean;
  changes?: ToolPreviewChange[];
}

export interface PermissionRequestPayload {
  requestId: string;
  toolName: string;
  args: unknown;
  /** 工具声明的风险等级，供确认界面展示 */
  risk?: 'read' | 'low' | 'medium' | 'high';
  /** 支持 dry-run 的工具会先生成结构化预览，再等待用户确认。 */
  preview?: ToolPreviewInfo;
}

/** ask_user 的一个选项（P6.1） */
export interface UserQuestionOption {
  id: string;
  label: string;
  hint?: string;
}

/** 主进程推给渲染层的提问请求（`ask:request`） */
export interface UserQuestionRequestPayload {
  requestId: string;
  question: string;
  options: UserQuestionOption[];
  allowFreeText: boolean;
  why?: string;
}

/** 渲染层的回答（`ask:respond`）：选项、自由文本、或"稍后再答" */
export interface UserQuestionResponse {
  requestId: string;
  optionId?: string;
  answer?: string;
  dismissed?: boolean;
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

/** 录音转写（腾讯云）设置：设置页只拿掩码，明文永不出主进程 */
export interface AsrSettingsInfo {
  secretIdMasked: string;
  secretKeyMasked: string;
  /** AppID 不是密钥，明文回显便于核对 */
  appId: string;
  engineType: import('../voice/asr-contract').AsrEngineType;
  diarization: boolean;
  configured: boolean;
  /** 未配置时指名道姓说缺哪个 */
  reason: string | null;
  credentialsSource: 'settings' | 'env' | 'none';
}

export interface AsrSettingsPatch {
  /** 凭证字段留空或省略表示不修改 */
  secretId?: string;
  secretKey?: string;
  appId?: string;
  engineType?: import('../voice/asr-contract').AsrEngineType;
  diarization?: boolean;
  /** 删除应用内保存的三个凭证，之后回落到环境变量 */
  clearCredentials?: boolean;
}

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

export interface VoiceCallInterruptPayload {
  callId: string;
}

export type VoiceCallSimpleResult = { ok: true } | { ok: false; error: string };

export interface VoiceSttCallStreamStartPayload {
  callId: string;
}

export type VoiceSttCallStreamStartResult = { ok: true } | { ok: false; error: string };

export interface VoiceSttCallStreamPushPayload {
  callId: string;
  chunk: ArrayBuffer;
}

export interface VoiceSttCallStreamFinishPayload {
  callId: string;
}

export type VoiceSttCallStreamFinishResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

export interface VoiceSttCallStreamAbortPayload {
  callId: string;
}

export type VoiceSynthesizeChunkResult =
  | { ok: true; audio: ArrayBuffer; mime: string }
  | { ok: false; error: string };

export type SpeechPlaybackStep =
  | { kind: 'pause'; durationMs: number }
  | { kind: 'audio'; audio: ArrayBuffer; mime: string };

export type VoiceSynthesizeResult =
  | { ok: true; steps: SpeechPlaybackStep[] }
  | { ok: false; error: string };
