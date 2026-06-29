import { ipcMain } from 'electron';
import { DATABASE_PATH } from '../../src/config/paths';
import { getModelConfigSafe } from '../../src/models/config';
import {
  createSession,
  getOrCreateDefaultSession,
  listSessions,
} from '../../src/db/repositories/sessions';
import { listMessages } from '../../src/db/repositories/messages';
import type { AppStatus, MessageInfo, SessionInfo } from '../../src/shared/types';

export function registerSessionIpc() {
  ipcMain.handle('app:status', (): AppStatus => {
    const config = getModelConfigSafe();
    return {
      model: config?.model ?? '未配置',
      baseUrl: config?.baseUrl ?? '',
      apiConfigured: Boolean(config),
      databasePath: DATABASE_PATH,
    };
  });

  ipcMain.handle('sessions:list', (): SessionInfo[] => {
    return listSessions().map((s) => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
  });

  ipcMain.handle('sessions:current', (): SessionInfo => {
    const session = getOrCreateDefaultSession();
    return {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  });

  ipcMain.handle('sessions:create', (): SessionInfo => {
    const session = createSession();
    return {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  });

  ipcMain.handle('messages:list', (_event, sessionId: string): MessageInfo[] => {
    return listMessages(sessionId).map((m) => ({
      id: m.id,
      sessionId: m.sessionId,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
    }));
  });
}
