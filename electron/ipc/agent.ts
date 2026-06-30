import { ipcMain } from 'electron';
import type { AgentSendPayload } from '../../src/shared/types';
import { cancelAllPendingPermissions } from './permission';
import { formatAttachmentsForMessage } from '../../src/workspace/import';
import { runOrchestrator } from '../../src/agent/orchestrator';
import { getModelConfigSafe } from '../../src/models/config';
import { recordTokenUsage } from '../../src/db/token-usage';
import {
  broadcastAgentEvent,
  onRunError,
  onRunFinished,
  onRunStarted,
} from '../state/presence';

const activeRuns = new Map<string, AbortController>();

export function registerAgentIpc() {
  ipcMain.handle('agent:send', async (_event, payload: AgentSendPayload) => {
    const controller = new AbortController();
    const runKey = `${payload.sessionId ?? 'default'}:${Date.now()}`;
    activeRuns.set(runKey, controller);

    onRunStarted();

    const userMessage = formatAttachmentsForMessage(
      payload.message,
      payload.attachments ?? [],
    );

    try {
      for await (const agEvent of runOrchestrator(
        userMessage,
        payload.sessionId,
        controller.signal,
      )) {
        if (controller.signal.aborted) break;

        if (agEvent.type === 'usage') {
          const config = getModelConfigSafe();
          if (config) {
            recordTokenUsage({
              sessionId: payload.sessionId,
              model: config.model,
              promptTokens: agEvent.promptTokens,
              completionTokens: agEvent.completionTokens,
              cachedTokens: agEvent.cachedTokens,
            });
          }
        }

        if (agEvent.type === 'run_finished') {
          onRunFinished();
        } else if (agEvent.type === 'run_error') {
          onRunError();
        }

        broadcastAgentEvent(agEvent);
      }
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      onRunError();
      broadcastAgentEvent({
        type: 'run_error',
        runId: runKey,
        message,
      });
      return { ok: false, error: message };
    } finally {
      activeRuns.delete(runKey);
    }
  });

  ipcMain.handle('agent:abort', () => {
    cancelAllPendingPermissions();
    for (const controller of activeRuns.values()) {
      controller.abort();
    }
    activeRuns.clear();
    onRunError();
    return { ok: true };
  });
}
