import { ipcMain, type WebContents } from 'electron';
import type { AgentSendPayload } from '../../src/shared/types';
import { runSimpleChat } from '../../src/agent/simple-chat';

const activeRuns = new Map<string, AbortController>();

function broadcastEvent(webContents: WebContents | null, event: unknown) {
  webContents?.send('agent:event', event);
}

export function registerAgentIpc(getWindow: () => Electron.BrowserWindow | null) {
  ipcMain.handle('agent:send', async (_event, payload: AgentSendPayload) => {
    const window = getWindow();
    const controller = new AbortController();
    const runKey = `${payload.sessionId ?? 'default'}:${Date.now()}`;
    activeRuns.set(runKey, controller);

    try {
      for await (const agEvent of runSimpleChat(payload.message, payload.sessionId)) {
        if (controller.signal.aborted) break;
        broadcastEvent(window?.webContents ?? null, agEvent);
      }
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      broadcastEvent(window?.webContents ?? null, {
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
    for (const controller of activeRuns.values()) {
      controller.abort();
    }
    activeRuns.clear();
    return { ok: true };
  });
}
