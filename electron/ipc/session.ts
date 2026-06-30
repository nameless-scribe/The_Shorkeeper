import { ipcMain } from 'electron';
import { DATABASE_PATH } from '../../src/config/paths';
import { getModelConfigSafe, getModelSettingsInfo } from '../../src/models/config';
import {
  deleteEmptySessions,
  deleteSession,
  getSession,
  listSessions,
  setSessionArchived,
} from '../../src/db/repositories/sessions';
import { getActiveSession, getActiveSessionId, resetActiveSession, switchActiveSession } from '../../src/session/active';
import { listMessages } from '../../src/db/repositories/messages';
import type { AppStatus, DeleteEmptySessionsResult, MessageInfo, SessionDeleteResult, SessionInfo, SessionListOptions, SessionListResult } from '../../src/shared/types';

function toSessionInfo(session: NonNullable<ReturnType<typeof getSession>>): SessionInfo {
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    archived: session.archived,
    compressed: session.compressed,
  };
}

export function registerSessionIpc() {
  ipcMain.handle('app:status', (): AppStatus => {
    const config = getModelConfigSafe();
    const settings = getModelSettingsInfo();
    return {
      model: config?.model ?? settings.model ?? '未配置',
      profileName: settings.configuredInApp ? settings.name : null,
      baseUrl: config?.baseUrl ?? settings.baseUrl ?? '',
      apiConfigured: Boolean(config),
      databasePath: DATABASE_PATH,
    };
  });

  ipcMain.handle(
    'sessions:list',
    (_event, options?: SessionListOptions): SessionListResult => {
      const result = listSessions(options ?? {});
      return {
        items: result.sessions.map(toSessionInfo),
        total: result.total,
        hasMore: result.hasMore,
      };
    },
  );

  ipcMain.handle('sessions:current', (): SessionInfo => {
    const session = getActiveSession();
    return toSessionInfo(session);
  });

  ipcMain.handle('sessions:create', (): SessionInfo => {
    const session = resetActiveSession();
    return toSessionInfo(session);
  });

  ipcMain.handle('sessions:switch', (_event, id: string): SessionInfo => {
    const session = switchActiveSession(id);
    return toSessionInfo(session);
  });

  ipcMain.handle('sessions:delete', (_event, id: string): SessionDeleteResult => {
    const wasActive = getActiveSessionId() === id;
    deleteSession(id);
    if (wasActive) {
      const session = resetActiveSession();
      return { ok: true, replacementSession: toSessionInfo(session) };
    }
    return { ok: true };
  });

  ipcMain.handle('sessions:deleteEmpty', (): DeleteEmptySessionsResult => {
    return deleteEmptySessions({ keepSessionId: getActiveSessionId() });
  });

  ipcMain.handle('sessions:archive', (_event, id: string, archived: boolean): SessionInfo => {
    setSessionArchived(id, archived);
    const session = getSession(id);
    if (!session) throw new Error('会话不存在');
    return toSessionInfo(session);
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
