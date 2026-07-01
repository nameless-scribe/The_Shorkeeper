import { getSession } from '../db/repositories/sessions';
import { getActiveSession } from '../session/active';

/** 解析 IPC / 调度器传入的 sessionId，与 orchestrator 使用同一规则。 */
export function resolveAgentSession(sessionId?: string) {
  return sessionId ? getSession(sessionId) : getActiveSession();

}
