import { randomUUID } from 'node:crypto';
import { trustedIpcMain as ipcMain } from './trusted-ipc';
import type { PermissionRequestPayload } from '../../src/shared/types';
import { getWindowManager } from '../windows/manager';
import { sendWhenWebContentsReady } from '../windows/web-contents';
import { parsePermissionResponse } from '../../src/shared/ipc-validation';

interface PendingPermission {
  resolve: (approved: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
  removeAbortListener?: () => void;
  removeWindowListener?: () => void;
  cancelPendingSend?: () => void;
}

const pending = new Map<string, PendingPermission>();

const PERMISSION_TIMEOUT_MS = 5 * 60 * 1000;

function resolvePermission(requestId: string, approved: boolean): void {
  const entry = pending.get(requestId);
  if (!entry) return;
  clearTimeout(entry.timer);
  entry.removeAbortListener?.();
  entry.removeWindowListener?.();
  entry.cancelPendingSend?.();
  pending.delete(requestId);
  entry.resolve(approved);
}

export function cancelAllPendingPermissions(): void {
  for (const requestId of pending.keys()) {
    resolvePermission(requestId, false);
  }
}

export async function requestPermissionConfirm(
  toolName: string,
  args: unknown,
  signal?: AbortSignal,
): Promise<boolean> {
  if (signal?.aborted) return false;

  const requestId = randomUUID();
  const chatWin = getWindowManager().show('chat');

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolvePermission(requestId, false), PERMISSION_TIMEOUT_MS);
    const onAbort = () => resolvePermission(requestId, false);
    const onWindowClosed = () => resolvePermission(requestId, false);
    const removeAbortListener = signal
      ? () => signal.removeEventListener('abort', onAbort)
      : undefined;
    const removeWindowListener = () => chatWin.removeListener('closed', onWindowClosed);
    pending.set(requestId, { resolve, timer, removeAbortListener, removeWindowListener });
    signal?.addEventListener('abort', onAbort, { once: true });
    chatWin.once('closed', onWindowClosed);
    if (signal?.aborted) onAbort();

    const payload: PermissionRequestPayload = { requestId, toolName, args };
    if (pending.has(requestId)) {
      pending.get(requestId)!.cancelPendingSend = sendWhenWebContentsReady(
        chatWin.webContents,
        'permission:request',
        payload,
      );
    }
  });
}

export function registerPermissionIpc(): void {
  ipcMain.handle(
    'permission:respond',
    (_event, rawPayload: unknown) => {
      const payload = parsePermissionResponse(rawPayload);
      resolvePermission(payload.requestId, payload.approved);
      return { ok: true };
    },
  );
}
