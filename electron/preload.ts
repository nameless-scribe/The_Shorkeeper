import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  AgentPresenceState,
  AgentSendPayload,
  AppStatus,
  MessageInfo,
  ProfileEntryInfo,
  ScheduleKind,
  ScheduledTaskInfo,
  UserTaskInfo,
  UserTaskStatus,
  SessionDeleteResult,
  DeleteEmptySessionsResult,
  SessionInfo,
  AssistantMode,
  MemoryCandidateInfo,
  MemoryCandidateStatus,
  SessionListOptions,
  SessionListResult,
  TokenUsageSummaryInfo,
  DockPreferencesInfo,
  WorkspaceAttachment,
  WorldbookEntryInfo,
  DocumentInfo,
  ImportProgress,
  ReindexProgress,
  ReindexResult,
  KnowledgeIndexCompatibilityInfo,
  ModelProtocol,
  ModelProfileInfo,
  ModelProfileInput,
  ModelProfilePatch,
  ModelProfilesInfo,
  ModelSettingsInfo,
  ModelSettingsPatch,
  EmbeddingSettingsInfo,
  EmbeddingSettingsPatch,
  McpServerInfo,
  PerformanceSettingsInfo,
  PluginSettingsInfo,
  PersonaSettingsInfo,
  PersonaSettingsPatch,
  AppearanceSettingsInfo,
  AppearanceAssetSlot,
  BackgroundFitMode,
  WebSearchSettingsInfo,
  WebSearchSettingsPatch,
  PermissionRequestPayload,
  FilesystemMode,
  SkillInfo,
  VoiceSettingsInfo,
  VoiceSettingsPatch,
  VoiceSynthesizePayload,
  VoiceSynthesizeChunkPayload,
  VoiceSynthesizeChunkResult,
  VoiceSynthesizeResult,
  VoiceTranscribePayload,
  VoiceTranscribeResult,
  VoiceCallStartPayload,
  VoiceCallStartResult,
  VoiceCallUserTextPayload,
  VoiceCallSpeakingDonePayload,
  VoiceCallEndPayload,
  VoiceCallInterruptPayload,
  VoiceCallSimpleResult,
  VoiceSttCallStreamStartPayload,
  VoiceSttCallStreamStartResult,
  VoiceSttCallStreamPushPayload,
  VoiceSttCallStreamFinishPayload,
  VoiceSttCallStreamFinishResult,
  VoiceSttCallStreamAbortPayload,
  UpdateInfo,
} from '../src/shared/types';
import type { RunTelemetrySnapshot } from '../src/agent/run-observability';

const shorekeeperApi = {
  agent: {
    send: (payload: AgentSendPayload) => ipcRenderer.invoke('agent:send', payload),
    abort: () => ipcRenderer.invoke('agent:abort'),
    diagnostics: (
      query?: { runId?: string; limit?: number },
    ): Promise<RunTelemetrySnapshot[] | RunTelemetrySnapshot | null> =>
      ipcRenderer.invoke('agent:diagnostics', query),
    onEvent: (callback: (event: unknown) => void) => {
      const listener = (_: Electron.IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on('agent:event', listener);
      return () => {
        ipcRenderer.removeListener('agent:event', listener);
      };
    },
  },
  app: {
    status: (): Promise<AppStatus> => ipcRenderer.invoke('app:status'),
  },
  sessions: {
    list: (options?: SessionListOptions): Promise<SessionListResult> =>
      ipcRenderer.invoke('sessions:list', options),
    current: (): Promise<SessionInfo> => ipcRenderer.invoke('sessions:current'),
    create: (): Promise<SessionInfo> => ipcRenderer.invoke('sessions:create'),
    switch: (id: string): Promise<SessionInfo> => ipcRenderer.invoke('sessions:switch', id),
    setMode: (id: string, mode: AssistantMode): Promise<SessionInfo> =>
      ipcRenderer.invoke('sessions:setMode', id, mode),
    delete: (id: string): Promise<SessionDeleteResult> =>
      ipcRenderer.invoke('sessions:delete', id),
    archive: (id: string, archived: boolean): Promise<SessionInfo> =>
      ipcRenderer.invoke('sessions:archive', id, archived),
    deleteEmpty: (): Promise<DeleteEmptySessionsResult> =>
      ipcRenderer.invoke('sessions:deleteEmpty'),
  },
  messages: {
    list: (sessionId: string): Promise<MessageInfo[]> =>
      ipcRenderer.invoke('messages:list', sessionId),
  },
  profile: {
    list: (): Promise<ProfileEntryInfo[]> => ipcRenderer.invoke('profile:list'),
    set: (key: string, value: string) => ipcRenderer.invoke('profile:set', key, value),
    delete: (key: string) => ipcRenderer.invoke('profile:delete', key),
  },
  persona: {
    get: (): Promise<PersonaSettingsInfo> => ipcRenderer.invoke('persona:get'),
    set: (patch: PersonaSettingsPatch): Promise<PersonaSettingsInfo> =>
      ipcRenderer.invoke('persona:set', patch),
    reset: (): Promise<PersonaSettingsInfo> => ipcRenderer.invoke('persona:reset'),
  },
  appearance: {
    get: (): Promise<AppearanceSettingsInfo> => ipcRenderer.invoke('appearance:get'),
    setPreset: (presetId: string): Promise<AppearanceSettingsInfo> =>
      ipcRenderer.invoke('appearance:setPreset', presetId),
    setVeilOpacity: (opacity: number): Promise<AppearanceSettingsInfo> =>
      ipcRenderer.invoke('appearance:setVeilOpacity', opacity),
    setBackgroundFit: (fit: BackgroundFitMode): Promise<AppearanceSettingsInfo> =>
      ipcRenderer.invoke('appearance:setBackgroundFit', fit),
    pickBackground: (): Promise<AppearanceSettingsInfo | null> =>
      ipcRenderer.invoke('appearance:pickBackground'),
    importBackground: (sourcePath: string): Promise<AppearanceSettingsInfo> =>
      ipcRenderer.invoke('appearance:importBackground', sourcePath),
    pickKeeperAvatar: (): Promise<AppearanceSettingsInfo | null> =>
      ipcRenderer.invoke('appearance:pickKeeperAvatar'),
    pickUserAvatar: (): Promise<AppearanceSettingsInfo | null> =>
      ipcRenderer.invoke('appearance:pickUserAvatar'),
    clearAsset: (slot: AppearanceAssetSlot): Promise<AppearanceSettingsInfo> =>
      ipcRenderer.invoke('appearance:clearAsset', slot),
    onChanged: (callback: (info: AppearanceSettingsInfo) => void) => {
      const listener = (_: Electron.IpcRendererEvent, data: AppearanceSettingsInfo) =>
        callback(data);
      ipcRenderer.on('appearance:changed', listener);
      return () => {
        ipcRenderer.removeListener('appearance:changed', listener);
      };
    },
  },
  worldbook: {
    list: (): Promise<WorldbookEntryInfo[]> => ipcRenderer.invoke('worldbook:list'),
    create: (input: {
      keys: string;
      content: string;
      priority?: number;
      enabled?: boolean;
    }) => ipcRenderer.invoke('worldbook:create', input),
    update: (
      id: string,
      patch: {
        keys?: string;
        content?: string;
        priority?: number;
        enabled?: boolean;
      },
    ) => ipcRenderer.invoke('worldbook:update', id, patch),
    delete: (id: string) => ipcRenderer.invoke('worldbook:delete', id),
  },
  memoryCandidates: {
    list: (status?: MemoryCandidateStatus, limit?: number): Promise<MemoryCandidateInfo[]> =>
      ipcRenderer.invoke('memory:candidates:list', status, limit),
    confirm: (id: string): Promise<MemoryCandidateInfo> =>
      ipcRenderer.invoke('memory:candidates:confirm', id),
    reject: (id: string): Promise<MemoryCandidateInfo> =>
      ipcRenderer.invoke('memory:candidates:reject', id),
  },
  documents: {
    list: (): Promise<DocumentInfo[]> => ipcRenderer.invoke('documents:list'),
    import: (): Promise<DocumentInfo | null> => ipcRenderer.invoke('documents:import'),
    delete: (id: string) => ipcRenderer.invoke('documents:delete', id),
    reindex: (): Promise<{ ok: boolean } & ReindexResult> => ipcRenderer.invoke('documents:reindex'),
    reindexOne: (id: string): Promise<DocumentInfo> =>
      ipcRenderer.invoke('documents:reindexOne', id),
    embeddingMismatch: (): Promise<KnowledgeIndexCompatibilityInfo> =>
      ipcRenderer.invoke('documents:embeddingMismatch'),
    onImportProgress: (callback: (progress: ImportProgress) => void) => {
      const listener = (_: Electron.IpcRendererEvent, data: ImportProgress) => callback(data);
      ipcRenderer.on('documents:importProgress', listener);
      return () => {
        ipcRenderer.removeListener('documents:importProgress', listener);
      };
    },
    onReindexProgress: (callback: (progress: ReindexProgress) => void) => {
      const listener = (_: Electron.IpcRendererEvent, data: ReindexProgress) => callback(data);
      ipcRenderer.on('documents:reindexProgress', listener);
      return () => {
        ipcRenderer.removeListener('documents:reindexProgress', listener);
      };
    },
  },
  embedding: {
    getSettings: (): Promise<EmbeddingSettingsInfo> =>
      ipcRenderer.invoke('embedding:getSettings'),
    setSettings: (patch: EmbeddingSettingsPatch): Promise<EmbeddingSettingsInfo> =>
      ipcRenderer.invoke('embedding:setSettings', patch),
    test: (): Promise<{ ok: boolean; message: string; dimensions?: number }> =>
      ipcRenderer.invoke('embedding:test'),
  },
  stats: {
    getTokenUsage: (): Promise<TokenUsageSummaryInfo> =>
      ipcRenderer.invoke('stats:getTokenUsage'),
  },
  presence: {
    get: (): Promise<AgentPresenceState> => ipcRenderer.invoke('presence:get'),
    feed: () => ipcRenderer.invoke('presence:feed'),
  },
  tasks: {
    list: (): Promise<ScheduledTaskInfo[]> => ipcRenderer.invoke('tasks:list'),
    create: (input: {
      name: string;
      scheduleKind?: ScheduleKind;
      cron?: string;
      runAt?: number | null;
      actionType: string;
      actionPayload: string;
      enabled?: boolean;
    }) => ipcRenderer.invoke('tasks:create', input),
    update: (
      id: string,
      patch: Partial<{
        name: string;
        scheduleKind: ScheduleKind;
        cron: string;
        runAt: number | null;
        actionType: string;
        actionPayload: string;
        enabled: boolean;
      }>,
    ) => ipcRenderer.invoke('tasks:update', id, patch),
    delete: (id: string) => ipcRenderer.invoke('tasks:delete', id),
    onUpdated: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('tasks:updated', listener);
      return () => {
        ipcRenderer.removeListener('tasks:updated', listener);
      };
    },
  },
  userTasks: {
    list: (filters?: {
      status?: UserTaskStatus;
      module?: string;
    }): Promise<UserTaskInfo[]> => ipcRenderer.invoke('userTasks:list', filters),
    update: (
      id: string,
      patch: Partial<{
        title: string;
        status: UserTaskStatus;
        notes: string;
        dueAt: string;
      }>,
    ) => ipcRenderer.invoke('userTasks:update', id, patch),
    onUpdated: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('userTasks:updated', listener);
      return () => {
        ipcRenderer.removeListener('userTasks:updated', listener);
      };
    },
  },
  workspace: {
    pickAndImport: (): Promise<WorkspaceAttachment | null> =>
      ipcRenderer.invoke('workspace:pickAndImport'),
    importPaths: (paths: string[]): Promise<WorkspaceAttachment[]> =>
      ipcRenderer.invoke('workspace:importPaths', paths),
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
    openRelative: (relativePath: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('workspace:openRelative', relativePath),
    showRelative: (relativePath: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('workspace:showRelative', relativePath),
    getFileInfo: (relativePath: string): Promise<WorkspaceAttachment | null> =>
      ipcRenderer.invoke('workspace:getFileInfo', relativePath),
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    close: () => ipcRenderer.send('window:close'),
    show: (kind: 'chat' | 'status' | 'schedule' | 'call') => ipcRenderer.invoke('window:show', kind),
    hide: (kind: 'chat' | 'status' | 'schedule' | 'call') => ipcRenderer.invoke('window:hide', kind),
    openSettings: () => ipcRenderer.invoke('window:openSettings'),
    destroyCall: () => ipcRenderer.invoke('window:destroyCall'),
    onOpenSettings: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('chat:openSettings', listener);
      return () => ipcRenderer.removeListener('chat:openSettings', listener);
    },
  },
  dock: {
    openChat: () => ipcRenderer.invoke('dock:openChat'),
    openSchedule: () => ipcRenderer.invoke('dock:openSchedule'),
    openStatus: () => ipcRenderer.invoke('dock:openStatus'),
    moveBy: (dx: number, dy: number) => ipcRenderer.invoke('dock:moveBy', dx, dy),
    getPreferences: (): Promise<DockPreferencesInfo> => ipcRenderer.invoke('dock:getPreferences'),
    setAlwaysOnTop: (enabled: boolean): Promise<DockPreferencesInfo> =>
      ipcRenderer.invoke('dock:setAlwaysOnTop', enabled),
    setPositionLocked: (locked: boolean): Promise<DockPreferencesInfo> =>
      ipcRenderer.invoke('dock:setPositionLocked', locked),
  },
  mcp: {
    list: (): Promise<McpServerInfo[]> => ipcRenderer.invoke('mcp:list'),
    create: (input: {
      name: string;
      command: string;
      args?: string[];
      env?: Record<string, string>;
      enabled?: boolean;
    }) => ipcRenderer.invoke('mcp:create', input),
    update: (
      id: string,
      patch: Partial<{
        name: string;
        command: string;
        args: string[];
        env: Record<string, string>;
        enabled: boolean;
      }>,
    ) => ipcRenderer.invoke('mcp:update', id, patch),
    delete: (id: string) => ipcRenderer.invoke('mcp:delete', id),
    test: (id: string): Promise<{ ok: boolean; tools: string[]; error?: string }> =>
      ipcRenderer.invoke('mcp:test', id),
  },
  skills: {
    list: (): Promise<SkillInfo[]> => ipcRenderer.invoke('skills:list'),
    getEnabled: (): Promise<string[]> => ipcRenderer.invoke('skills:getEnabled'),
    toggle: (id: string, enabled: boolean): Promise<SkillInfo[]> =>
      ipcRenderer.invoke('skills:toggle', id, enabled),
  },
  model: {
    getProtocol: (): Promise<ModelProtocol> => ipcRenderer.invoke('model:getProtocol'),
    setProtocol: (protocol: ModelProtocol): Promise<ModelProtocol> =>
      ipcRenderer.invoke('model:setProtocol', protocol),
    getSettings: (): Promise<ModelSettingsInfo> => ipcRenderer.invoke('model:getSettings'),
    setSettings: (patch: ModelSettingsPatch): Promise<ModelSettingsInfo> =>
      ipcRenderer.invoke('model:setSettings', patch),
    getProfiles: (): Promise<ModelProfilesInfo> => ipcRenderer.invoke('model:getProfiles'),
    createProfile: (input: ModelProfileInput): Promise<ModelProfilesInfo> =>
      ipcRenderer.invoke('model:createProfile', input),
    updateProfile: (id: string, patch: ModelProfilePatch): Promise<ModelProfilesInfo> =>
      ipcRenderer.invoke('model:updateProfile', id, patch),
    deleteProfile: (id: string): Promise<ModelProfilesInfo> =>
      ipcRenderer.invoke('model:deleteProfile', id),
    setActiveProfile: (id: string): Promise<ModelProfilesInfo> =>
      ipcRenderer.invoke('model:setActiveProfile', id),
  },
  performance: {
    get: (): Promise<PerformanceSettingsInfo> => ipcRenderer.invoke('performance:get'),
    set: (patch: Partial<PerformanceSettingsInfo>): Promise<PerformanceSettingsInfo> =>
      ipcRenderer.invoke('performance:set', patch),
  },
  plugins: {
    get: (): Promise<PluginSettingsInfo> => ipcRenderer.invoke('plugins:get'),
    set: (patch: Partial<PluginSettingsInfo>): Promise<PluginSettingsInfo> =>
      ipcRenderer.invoke('plugins:set', patch),
    setFilesystemMode: (mode: FilesystemMode): Promise<PluginSettingsInfo> =>
      ipcRenderer.invoke('plugins:setFilesystemMode', mode),
  },
  webSearch: {
    getSettings: (): Promise<WebSearchSettingsInfo> => ipcRenderer.invoke('web-search:getSettings'),
    saveSettings: (patch: WebSearchSettingsPatch): Promise<WebSearchSettingsInfo> =>
      ipcRenderer.invoke('web-search:saveSettings', patch),
  },
  voice: {
    getSettings: (): Promise<VoiceSettingsInfo> => ipcRenderer.invoke('voice:getSettings'),
    saveSettings: (patch: VoiceSettingsPatch): Promise<VoiceSettingsInfo> =>
      ipcRenderer.invoke('voice:saveSettings', patch),
    synthesize: (payload: VoiceSynthesizePayload): Promise<VoiceSynthesizeResult> =>
      ipcRenderer.invoke('voice:synthesize', payload),
    synthesizeChunk: (payload: VoiceSynthesizeChunkPayload): Promise<VoiceSynthesizeChunkResult> =>
      ipcRenderer.invoke('voice:synthesizeChunk', payload),
    transcribe: (payload: VoiceTranscribePayload): Promise<VoiceTranscribeResult> =>
      ipcRenderer.invoke('voice:transcribe', payload),
    stt: {
      startCallStream: (
        payload: VoiceSttCallStreamStartPayload,
      ): Promise<VoiceSttCallStreamStartResult> =>
        ipcRenderer.invoke('voice:stt:startCallStream', payload),
      pushChunk: (payload: VoiceSttCallStreamPushPayload): Promise<VoiceSttCallStreamStartResult> =>
        ipcRenderer.invoke('voice:stt:pushChunk', payload),
      finishCallStream: (
        payload: VoiceSttCallStreamFinishPayload,
      ): Promise<VoiceSttCallStreamFinishResult> =>
        ipcRenderer.invoke('voice:stt:finishCallStream', payload),
      abortCallStream: (
        payload: VoiceSttCallStreamAbortPayload,
      ): Promise<VoiceSttCallStreamStartResult> =>
        ipcRenderer.invoke('voice:stt:abortCallStream', payload),
    },
    call: {
      start: (payload: VoiceCallStartPayload): Promise<VoiceCallStartResult> =>
        ipcRenderer.invoke('voice:call:start', payload),
      userText: (payload: VoiceCallUserTextPayload): Promise<VoiceCallSimpleResult> =>
        ipcRenderer.invoke('voice:call:userText', payload),
      speakingDone: (payload: VoiceCallSpeakingDonePayload): Promise<VoiceCallSimpleResult> =>
        ipcRenderer.invoke('voice:call:speakingDone', payload),
      interrupt: (payload: VoiceCallInterruptPayload): Promise<VoiceCallSimpleResult> =>
        ipcRenderer.invoke('voice:call:interrupt', payload),
      end: (payload: VoiceCallEndPayload): Promise<VoiceCallSimpleResult> =>
        ipcRenderer.invoke('voice:call:end', payload),
      isActive: (sessionId?: string): Promise<{ active: boolean }> =>
        ipcRenderer.invoke('voice:call:isActive', sessionId),
    },
  },
  permission: {
    respond: (requestId: string, approved: boolean) =>
      ipcRenderer.invoke('permission:respond', { requestId, approved }),
    onRequest: (callback: (payload: PermissionRequestPayload) => void) => {
      const listener = (_: Electron.IpcRendererEvent, data: PermissionRequestPayload) =>
        callback(data);
      ipcRenderer.on('permission:request', listener);
      return () => {
        ipcRenderer.removeListener('permission:request', listener);
      };
    },
  },
  update: {
    getVersion: (): Promise<string> => ipcRenderer.invoke('update:getVersion'),
    getStatus: (): Promise<UpdateInfo> => ipcRenderer.invoke('update:getStatus'),
    check: (): Promise<UpdateInfo> => ipcRenderer.invoke('update:check'),
    install: (): Promise<void> => ipcRenderer.invoke('update:install'),
    onStatus: (callback: (info: UpdateInfo) => void) => {
      const listener = (_: Electron.IpcRendererEvent, data: UpdateInfo) => callback(data);
      ipcRenderer.on('update:status', listener);
      return () => {
        ipcRenderer.removeListener('update:status', listener);
      };
    },
  },
};

contextBridge.exposeInMainWorld('shorekeeper', shorekeeperApi);

export type ShorekeeperApi = typeof shorekeeperApi;
