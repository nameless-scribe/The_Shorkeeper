import { trustedIpcMain as ipcMain } from './trusted-ipc';
import { getDatabasePath } from '../../src/config/paths';
import { resolveDatabaseRuntime } from '../../src/db/engine-state';
import { getModelConfigSafe, getModelSettingsInfo } from '../../src/models/config';
import {
  deleteEmptySessions,
  deleteSession,
  getSession,
  listSessions,
  setSessionArchived,
  setSessionAssistantMode,
} from '../../src/db/repositories/sessions';
import { normalizeAssistantMode } from '../../src/assistant/mode';
import { isSessionRunActive } from '../../src/agent/session-run-lock';
import { getActiveSession, getActiveSessionId, resetActiveSession, switchActiveSession } from '../../src/session/active';
import { listMessages } from '../../src/db/repositories/messages';
import type { AppStatus, AssistantMode, DeleteEmptySessionsResult, MessageInfo, SessionDeleteResult, SessionInfo, SessionListOptions, SessionListResult } from '../../src/shared/types';
import {
  requireBoolean,
  requireEnum,
  requireFiniteNumber,
  requireRecord,
  requireString,
} from '../../src/shared/ipc-validation';

const SESSION_BUSY_ERROR = '该会话正在处理消息';

function toSessionInfo(session: NonNullable<ReturnType<typeof getSession>>): SessionInfo {
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    archived: session.archived,
    compressed: session.compressed,
    assistantMode: session.assistantMode,
  };
}

function assertSessionNotBusy(sessionId: string): void {
  if (isSessionRunActive(sessionId)) {
    throw new Error(SESSION_BUSY_ERROR);
  }
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
      databasePath: resolveDatabaseRuntime(getDatabasePath()).databasePath,
    };
  });

  ipcMain.handle(
    'sessions:list',
    (_event, options?: SessionListOptions): SessionListResult => {
      const input = options === undefined ? {} : requireRecord(options, '会话列表参数');
      const normalized: SessionListOptions = {
        includeArchived: input.includeArchived === undefined
          ? undefined
          : requireBoolean(input.includeArchived, 'includeArchived'),
        query: input.query === undefined
          ? undefined
          : requireString(input.query, '搜索词', { allowEmpty: true, maxLength: 1_000 }),
        limit: input.limit === undefined
          ? undefined
          : Math.floor(requireFiniteNumber(input.limit, 'limit', { min: 1, max: 200 })),
        offset: input.offset === undefined
          ? undefined
          : Math.floor(requireFiniteNumber(input.offset, 'offset', { min: 0, max: 1_000_000 })),
      };
      const result = listSessions(normalized);
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

  ipcMain.handle('sessions:switch', (_event, rawId: unknown): SessionInfo => {
    const id = requireString(rawId, '会话 ID', { maxLength: 200 });
    assertSessionNotBusy(id);
    const session = switchActiveSession(id);
    return toSessionInfo(session);
  });

  ipcMain.handle('sessions:delete', (_event, rawId: unknown): SessionDeleteResult => {
    const id = requireString(rawId, '会话 ID', { maxLength: 200 });
    if (isSessionRunActive(id)) {
      return { ok: false, error: SESSION_BUSY_ERROR, busy: true };
    }
    const wasActive = getActiveSessionId() === id;
    deleteSession(id);
    if (wasActive) {
      const session = resetActiveSession();
      return { ok: true, replacementSession: toSessionInfo(session) };
    }
    return { ok: true };
  });

  ipcMain.handle('sessions:deleteEmpty', (): DeleteEmptySessionsResult => {
    const keepId = getActiveSessionId();
    const { sessions } = listSessions({ limit: 500 });
    const excludeIds = sessions
      .map((s) => s.id)
      .filter((id) => id !== keepId && isSessionRunActive(id));
    return deleteEmptySessions({ keepSessionId: keepId, excludeSessionIds: excludeIds });
  });

  ipcMain.handle('sessions:archive', (_event, rawId: unknown, rawArchived: unknown): SessionInfo => {
    const id = requireString(rawId, '会话 ID', { maxLength: 200 });
    const archived = requireBoolean(rawArchived, 'archived');
    assertSessionNotBusy(id);
    setSessionArchived(id, archived);
    if (archived && getActiveSessionId() === id) {
      const { sessions } = listSessions({ limit: 1 });
      if (sessions[0] && sessions[0].id !== id) {
        switchActiveSession(sessions[0].id);
      } else {
        resetActiveSession();
      }
    }
    const session = getSession(id);
    if (!session) throw new Error('会话不存在');
    return toSessionInfo(session);
  });

  ipcMain.handle('sessions:setMode', (_event, rawId: unknown, rawMode: unknown): SessionInfo => {
    const id = requireString(rawId, '会话 ID', { maxLength: 200 });
    const mode = requireEnum(
      rawMode,
      '助手模式',
      ['focus', 'organize', 'review', 'companion'] as const,
    ) as AssistantMode;
    assertSessionNotBusy(id);
    if (!getSession(id)) throw new Error('会话不存在');
    setSessionAssistantMode(id, normalizeAssistantMode(mode));
    const session = getSession(id);
    if (!session) throw new Error('会话不存在');
    return toSessionInfo(session);
  });

  ipcMain.handle('messages:list', (_event, rawSessionId: unknown): MessageInfo[] => {
    const sessionId = requireString(rawSessionId, '会话 ID', { maxLength: 200 });
    return listMessages(sessionId).map((m) => ({
      id: m.id,
      sessionId: m.sessionId,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
    }));
  });
}
