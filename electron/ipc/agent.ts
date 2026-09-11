import { ipcMain } from 'electron';
import type { AgentSendPayload } from '../../src/shared/types';
import { ev } from '../../src/agent/events';
import {
  acquireSessionRun,
  abortAllSessionRuns,
  releaseSessionRun,
  setSessionRunId,
} from '../../src/agent/session-run-lock';
import { resolveAgentSession } from '../../src/agent/resolve-session';
import { cancelAllPendingPermissions } from './permission';
import { formatAttachmentsForMessage } from '../../src/workspace/import';
import { enrichAttachmentsMessage } from '../../src/workspace/attachment-preparse';
import { runOrchestrator } from '../../src/agent/orchestrator';
import { getModelConfigSafe } from '../../src/models/config';
import { recordTokenUsage } from '../../src/db/token-usage';
import {
  getRunDiagnostic,
  listRunDiagnostics,
} from '../../src/agent/run-observability';
import {
  broadcastAgentEvent,
  onRunError,
  onRunFinished,
  onRunStarted,
} from '../state/presence';

export function registerAgentIpc() {
  ipcMain.handle('agent:send', async (_event, payload: AgentSendPayload) => {
    const session = resolveAgentSession(payload.sessionId);
    if (!session) {
      return { ok: false, error: '会话不存在' };
    }

    const resolvedSessionId = session.id;
    const controller = acquireSessionRun(resolvedSessionId);
    if (!controller) {
      return { ok: false, error: '上一条消息仍在处理中' };
    }

    onRunStarted();

    let runId: string | null = null;
    let terminalError: string | null = null;
    let presenceSettled = false;

    try {
      const baseMessage = formatAttachmentsForMessage(
        payload.message,
        payload.attachments ?? [],
      );
      const userMessage = await enrichAttachmentsMessage(
        baseMessage,
        payload.attachments ?? [],
      );

      for await (const agEvent of runOrchestrator(
        userMessage,
        resolvedSessionId,
        controller.signal,
      )) {
        if (controller.signal.aborted) break;

        if (agEvent.type === 'run_started') {
          runId = agEvent.runId;
          setSessionRunId(resolvedSessionId, agEvent.runId);
        }

        if (agEvent.type === 'usage') {
          const config = getModelConfigSafe();
          if (config) {
            recordTokenUsage({
              sessionId: resolvedSessionId,
              model: config.model,
              promptTokens: agEvent.promptTokens,
              completionTokens: agEvent.completionTokens,
              cachedTokens: agEvent.cachedTokens,
            });
          }
        }

        if (agEvent.type === 'run_finished') {
          onRunFinished();
          presenceSettled = true;
        } else if (agEvent.type === 'run_error') {
          onRunError();
          presenceSettled = true;
          terminalError = agEvent.message;
        }

        broadcastAgentEvent(agEvent);
      }

      if (terminalError) {
        return { ok: false, error: terminalError, runId };
      }
      return { ok: true, runId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!presenceSettled) {
        onRunError();
        presenceSettled = true;
      }
      broadcastAgentEvent(
        ev.runError(runId ?? 'unknown', message, resolvedSessionId),
      );
      return { ok: false, error: message, runId };
    } finally {
      if (!presenceSettled) onRunError();
      releaseSessionRun(resolvedSessionId, controller);
    }
  });

  ipcMain.handle('agent:abort', () => {
    cancelAllPendingPermissions();
    const cancelled = abortAllSessionRuns();
    for (const { sessionId, runId } of cancelled) {
      broadcastAgentEvent(
        ev.runError(runId ?? 'unknown', '已取消', sessionId),
      );
    }
    return { ok: true };
  });

  ipcMain.handle(
    'agent:diagnostics',
    (_event, query?: { runId?: unknown; limit?: unknown }) => {
      if (typeof query?.runId === 'string' && query.runId.trim()) {
        return getRunDiagnostic(query.runId.trim());
      }
      const limit = typeof query?.limit === 'number' ? query.limit : undefined;
      return listRunDiagnostics(limit);
    },
  );
}

export { isSessionRunActive } from '../../src/agent/session-run-lock';
