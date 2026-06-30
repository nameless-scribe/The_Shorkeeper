import { randomUUID } from 'node:crypto';
import { ipcMain } from 'electron';
import type { PermissionRequestPayload } from '../../src/shared/types';
import { getWindowManager } from '../windows/manager';

interface PendingPermission {
  resolve: (approved: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingPermission>();

const PERMISSION_TIMEOUT_MS = 5 * 60 * 1000;

function resolvePermission(requestId: string, approved: boolean): void {
  const entry = pending.get(requestId);
  if (!entry) return;
  clearTimeout(entry.timer);
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
): Promise<boolean> {
  const requestId = randomUUID();
  const chatWin = getWindowManager().show('chat');

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolvePermission(requestId, false), PERMISSION_TIMEOUT_MS);
    pending.set(requestId, { resolve, timer });

    const payload: PermissionRequestPayload = { requestId, toolName, args };
    chatWin.webContents.send('permission:request', payload);
  });
}

export function registerPermissionIpc(): void {
  ipcMain.handle(
    'permission:respond',
    (_event, payload: { requestId: string; approved: boolean }) => {
      resolvePermission(payload.requestId, payload.approved);
      return { ok: true };
    },
  );
}
