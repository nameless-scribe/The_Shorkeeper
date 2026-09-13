import {
  ipcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron';
import { assertTrustedIpcSender } from '../windows/security';

type InvokeListener = (
  event: IpcMainInvokeEvent,
  ...args: any[]
) => any;

type EventListener = (
  event: IpcMainEvent,
  ...args: any[]
) => void;

/**
 * IPC registrations must pass through this boundary so a renderer that did not
 * load one of our application pages cannot reach privileged main-process APIs.
 */
export const trustedIpcMain = {
  handle(channel: string, listener: InvokeListener): void {
    ipcMain.handle(channel, (event, ...args) => {
      assertTrustedIpcSender(event);
      return listener(event, ...args);
    });
  },

  on(channel: string, listener: EventListener): void {
    ipcMain.on(channel, (event, ...args) => {
      try {
        assertTrustedIpcSender(event);
      } catch (error) {
        // One-way IPC has no response promise to reject. Contain an untrusted
        // event instead of turning it into an uncaught main-process exception.
        console.warn(`[ipc] 已忽略非受信的单向请求 (${channel}):`, error);
        return;
      }
      listener(event, ...args);
    });
  },
};
