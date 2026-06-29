import { contextBridge, ipcRenderer } from 'electron';
import type {
  AgentSendPayload,
  AppStatus,
  MessageInfo,
  ProfileEntryInfo,
  SessionInfo,
  WorldbookEntryInfo,
} from '../src/shared/types';

const shorekeeperApi = {
  agent: {
    send: (payload: AgentSendPayload) => ipcRenderer.invoke('agent:send', payload),
    abort: () => ipcRenderer.invoke('agent:abort'),
    onEvent: (callback: (event: unknown) => void) => {
      const listener = (_: Electron.IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on('agent:event', listener);
      return () => ipcRenderer.removeListener('agent:event', listener);
    },
  },
  app: {
    status: (): Promise<AppStatus> => ipcRenderer.invoke('app:status'),
  },
  sessions: {
    list: (): Promise<SessionInfo[]> => ipcRenderer.invoke('sessions:list'),
    current: (): Promise<SessionInfo> => ipcRenderer.invoke('sessions:current'),
    create: (): Promise<SessionInfo> => ipcRenderer.invoke('sessions:create'),
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
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    close: () => ipcRenderer.send('window:close'),
  },
};

contextBridge.exposeInMainWorld('shorekeeper', shorekeeperApi);

export type ShorekeeperApi = typeof shorekeeperApi;
