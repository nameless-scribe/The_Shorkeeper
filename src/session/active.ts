import { createSession, getSession, type Session } from '../db/repositories/sessions';
import type { AppDatabase } from '../db';

let activeSessionId: string | null = null;

/** 应用启动或用户点「新对话」时调用 */
export function resetActiveSession(db?: AppDatabase): Session {
  const session = createSession(db);
  activeSessionId = session.id;
  return session;
}

export function getActiveSession(db?: AppDatabase): Session {
  if (!activeSessionId) {
    return resetActiveSession(db);
  }
  const existing = getSession(activeSessionId, db);
  if (!existing) {
    return resetActiveSession(db);
  }
  return existing;
}

export function setActiveSessionId(id: string): void {
  activeSessionId = id;
}

/** 切换到已有会话（不新建） */
export function switchActiveSession(id: string, db?: AppDatabase): Session {
  const session = getSession(id, db);
  if (!session) {
    throw new Error('会话不存在');
  }
  activeSessionId = id;
  return session;
}

export function getActiveSessionId(): string | null {
  return activeSessionId;
}

/** 测试用：清除内存中的活跃会话指针 */
export function clearActiveSessionForTests(): void {
  activeSessionId = null;
}
