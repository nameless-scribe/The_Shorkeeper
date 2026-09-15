import type { AgentSendPayload } from '../../src/shared/types';
import { trustedIpcMain as ipcMain } from './trusted-ipc';
import { parseAgentSendPayload } from '../../src/shared/ipc-validation';
import { requireFiniteNumber, requireRecord, requireString } from '../../src/shared/ipc-validation';
import { ev } from '../../src/agent/events';
import {
  acquireSessionRun,
  abortAllSessionRuns,
  releaseSessionRun,
  setSessionRunId,
} from '../../src/agent/session-run-lock';
import { resolveAgentSession } from '../../src/agent/resolve-session';
import { cancelAllPendingPermissions } from './permission';
import { cancelAllPendingQuestions } from './ask';
import { formatAttachmentsForMessage } from '../../src/workspace/import';
import { enrichAttachmentsMessage } from '../../src/workspace/attachment-preparse';
import { runOrchestrator } from '../../src/agent/orchestrator';
import {
  getRunDiagnostic,
  listRunDiagnostics,
} from '../../src/agent/run-observability';
import {
  getTaskRun,
  listApprovals,
  listRunArtifacts,
  listTaskRunSteps,
  listTaskRuns,
} from '../../src/db/repositories/task-runs';
import type { TaskRunDetail, TaskRunInfo } from '../../src/shared/types';
import { listTaskRunContextSources } from '../../src/db/repositories/context-sources';
import { resolveContextSourceRef } from '../../src/agent/context-sources';
import {
  broadcastAgentEvent,
  onRunError,
  onRunFinished,
  onRunStarted,
} from '../state/presence';

export function registerAgentIpc() {
  ipcMain.handle('agent:send', async (event, rawPayload: AgentSendPayload) => {
    const payload = parseAgentSendPayload(rawPayload);
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
    const abortOnSenderDestroyed = () => controller.abort();
    event.sender.once('destroyed', abortOnSenderDestroyed);

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
      event.sender.removeListener('destroyed', abortOnSenderDestroyed);
      if (!presenceSettled) onRunError();
      releaseSessionRun(resolvedSessionId, controller);
    }
  });

  ipcMain.handle('agent:abort', () => {
    cancelAllPendingPermissions();
    cancelAllPendingQuestions();
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
      if (query === undefined) return listRunDiagnostics();
      const input = requireRecord(query, '运行诊断参数');
      if (input.runId !== undefined) {
        return getRunDiagnostic(requireString(input.runId, 'runId', { maxLength: 200 }).trim());
      }
      const limit = input.limit === undefined
        ? undefined
        : Math.floor(requireFiniteNumber(input.limit, 'limit', { min: 1, max: 100 }));
      return listRunDiagnostics(limit);
    },
  );

  // 持久化的运行记录：与内存诊断不同，应用重启后仍可解释每次 run 的状态和产物。
  ipcMain.handle(
    'agent:runHistory',
    (_event, query?: { sessionId?: unknown; limit?: unknown }): TaskRunInfo[] => {
      if (query === undefined) return listTaskRuns();
      const input = requireRecord(query, '运行记录参数');
      const sessionId = input.sessionId === undefined
        ? undefined
        : requireString(input.sessionId, 'sessionId', { maxLength: 200 }).trim();
      const limit = input.limit === undefined
        ? undefined
        : Math.floor(requireFiniteNumber(input.limit, 'limit', { min: 1, max: 500 }));
      return listTaskRuns({ sessionId, limit });
    },
  );

  ipcMain.handle('agent:runDetail', (_event, rawRunId: unknown): TaskRunDetail | null => {
    const runId = requireString(rawRunId, 'runId', { maxLength: 200 }).trim();
    const run = getTaskRun(runId);
    if (!run) return null;
    return {
      run,
      steps: listTaskRunSteps(runId),
      artifacts: listRunArtifacts(runId),
      approvals: listApprovals({ runId }),
      contextSources: listTaskRunContextSources(runId),
    };
  });

  ipcMain.handle('agent:sourceDetail', (_event, rawSourceRef: unknown) => {
    const sourceRef = requireString(rawSourceRef, 'sourceRef', { maxLength: 240 }).trim();
    return resolveContextSourceRef(sourceRef);
  });
}

export { isSessionRunActive } from '../../src/agent/session-run-lock';
