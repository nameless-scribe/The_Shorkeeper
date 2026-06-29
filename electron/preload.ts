import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  AgentPresenceState,
  AgentSendPayload,
  AppStatus,
  MessageInfo,
  ProfileEntryInfo,
  ScheduleKind,
  ScheduledTaskInfo,
  SessionInfo,
  TokenUsageSummaryInfo,
  DockPreferencesInfo,
  WorkspaceAttachment,
  WorldbookEntryInfo,
  DocumentInfo,
  ImportProgress,
} from '../src/shared/types';

const shorekeeperApi = {
  agent: {
    send: (payload: AgentSendPayload) => ipcRenderer.invoke('agent:send', payload),
    abort: () => ipcRenderer.invoke('agent:abort'),
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
    list: (): Promise<SessionInfo[]> => ipcRenderer.invoke('sessions:list'),
    current: (): Promise<SessionInfo> => ipcRenderer.invoke('sessions:current'),
    create: (): Promise<SessionInfo> => ipcRenderer.invoke('sessions:create'),
    switch: (id: string): Promise<SessionInfo> => ipcRenderer.invoke('sessions:switch', id),
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
  documents: {
    list: (): Promise<DocumentInfo[]> => ipcRenderer.invoke('documents:list'),
    import: (): Promise<DocumentInfo | null> => ipcRenderer.invoke('documents:import'),
    delete: (id: string) => ipcRenderer.invoke('documents:delete', id),
    onImportProgress: (callback: (progress: ImportProgress) => void) => {
      const listener = (_: Electron.IpcRendererEvent, data: ImportProgress) => callback(data);
      ipcRenderer.on('documents:importProgress', listener);
      return () => {
        ipcRenderer.removeListener('documents:importProgress', listener);
      };
    },
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
  workspace: {
    pickAndImport: (): Promise<WorkspaceAttachment | null> =>
      ipcRenderer.invoke('workspace:pickAndImport'),
    importPaths: (paths: string[]): Promise<WorkspaceAttachment[]> =>
      ipcRenderer.invoke('workspace:importPaths', paths),
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    close: () => ipcRenderer.send('window:close'),
    show: (kind: 'chat' | 'status' | 'schedule') => ipcRenderer.invoke('window:show', kind),
    hide: (kind: 'chat' | 'status' | 'schedule') => ipcRenderer.invoke('window:hide', kind),
    openSettings: () => ipcRenderer.invoke('window:openSettings'),
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
};

contextBridge.exposeInMainWorld('shorekeeper', shorekeeperApi);

export type ShorekeeperApi = typeof shorekeeperApi;
