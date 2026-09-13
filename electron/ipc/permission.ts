import { randomUUID } from 'node:crypto';
import { trustedIpcMain as ipcMain } from './trusted-ipc';
import type { ApprovalDecider, PermissionRequestPayload } from '../../src/shared/types';
import type {
  PermissionConfirmContext,
  PermissionConfirmOutcome,
} from '../../src/agent/permissions';
import { getWindowManager } from '../windows/manager';
import { sendWhenWebContentsReady } from '../windows/web-contents';
import { parsePermissionResponse } from '../../src/shared/ipc-validation';

interface PendingPermission {
  resolve: (outcome: PermissionConfirmOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
  removeAbortListener?: () => void;
  removeWindowListener?: () => void;
  cancelPendingSend?: () => void;
}

const pending = new Map<string, PendingPermission>();

const PERMISSION_TIMEOUT_MS = 5 * 60 * 1000;

function resolvePermission(
  requestId: string,
  approved: boolean,
  decidedBy: ApprovalDecider,
): void {
  const entry = pending.get(requestId);
  if (!entry) return;
  clearTimeout(entry.timer);
  entry.removeAbortListener?.();
  entry.removeWindowListener?.();
  entry.cancelPendingSend?.();
  pending.delete(requestId);
  entry.resolve({ approved, decidedBy });
}

export function cancelAllPendingPermissions(): void {
  for (const requestId of pending.keys()) {
    resolvePermission(requestId, false, 'abort');
  }
}

export async function requestPermissionConfirm(
  toolName: string,
  args: unknown,
  signal?: AbortSignal,
  context?: PermissionConfirmContext,
): Promise<PermissionConfirmOutcome> {
  if (signal?.aborted) return { approved: false, decidedBy: 'abort' };

  const requestId = randomUUID();
  const chatWin = getWindowManager().show('chat');

  return new Promise((resolve) => {
    const timer = setTimeout(
      () => resolvePermission(requestId, false, 'timeout'),
      PERMISSION_TIMEOUT_MS,
    );
    const onAbort = () => resolvePermission(requestId, false, 'abort');
    const onWindowClosed = () => resolvePermission(requestId, false, 'window_closed');
    const removeAbortListener = signal
      ? () => signal.removeEventListener('abort', onAbort)
      : undefined;
    const removeWindowListener = () => chatWin.removeListener('closed', onWindowClosed);
    pending.set(requestId, { resolve, timer, removeAbortListener, removeWindowListener });
    signal?.addEventListener('abort', onAbort, { once: true });
    chatWin.once('closed', onWindowClosed);
    if (signal?.aborted) onAbort();

    const payload: PermissionRequestPayload = {
      requestId,
      toolName,
      args,
      ...(context?.risk ? { risk: context.risk } : {}),
    };
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
      resolvePermission(payload.requestId, payload.approved, 'user');
      return { ok: true };
    },
  );
}
