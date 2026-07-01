import { getSetting, setSetting } from '../db/app-settings';
import {
  createSession,
  getSession,
  listSessions,
  type Session,
} from '../db/repositories/sessions';
import type { AppDatabase } from '../db';

export const ACTIVE_SESSION_KEY = 'session.active_id';

let activeSessionId: string | null = null;

function persistActiveSessionId(id: string, db?: AppDatabase): void {
  setSetting(ACTIVE_SESSION_KEY, id);
  void db;
}

function readPersistedActiveSessionId(): string | null {
  return getSetting(ACTIVE_SESSION_KEY);
}

/** 应用启动时恢复上次会话，避免每次重启都新建空对话 */
export function restoreActiveSession(db?: AppDatabase): Session {
  const persisted = readPersistedActiveSessionId();
  if (persisted) {
    const existing = getSession(persisted, db);
    if (existing && !existing.archived) {
      activeSessionId = persisted;
      return existing;
    }
  }

  const { sessions } = listSessions({ limit: 1 }, db);
  const firstActive = sessions.find((s) => !s.archived);
  if (firstActive) {
    activeSessionId = firstActive.id;
    persistActiveSessionId(firstActive.id, db);
    return firstActive;
  }

  return resetActiveSession(db);
}

/** 用户点「新对话」时调用 */
export function resetActiveSession(db?: AppDatabase): Session {
  const session = createSession(db);
  activeSessionId = session.id;
  persistActiveSessionId(session.id, db);
  return session;
}

export function getActiveSession(db?: AppDatabase): Session {
  if (!activeSessionId) {
    return restoreActiveSession(db);
  }
  const existing = getSession(activeSessionId, db);
  if (!existing) {
    return restoreActiveSession(db);
  }
  return existing;
}

export function setActiveSessionId(id: string): void {
  activeSessionId = id;
  persistActiveSessionId(id);
}

/** 切换到已有会话（不新建） */
export function switchActiveSession(id: string, db?: AppDatabase): Session {
  const session = getSession(id, db);
  if (!session) {
    throw new Error('会话不存在');
  }
  if (session.archived) {
    throw new Error('无法切换到已归档的会话');
  }
  activeSessionId = id;
  persistActiveSessionId(id, db);
  return session;
}

export function getActiveSessionId(): string | null {
  return activeSessionId;
}

/** 测试用：清除内存中的活跃会话指针（不删 app_settings） */
export function clearActiveSessionForTests(): void {
  activeSessionId = null;
}
