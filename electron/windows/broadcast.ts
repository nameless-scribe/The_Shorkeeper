import { getDockWindow } from './dock';
import { getWindowManager } from './manager';
import { safeSendToWebContents } from './web-contents';

/** 向主面板与 Dock 悬浮窗广播 IPC 事件 */
export function broadcastToAllRendererWindows(channel: string, payload: unknown): void {
  getWindowManager().broadcast(channel, payload);

  const dock = getDockWindow();
  if (dock && !dock.isDestroyed()) {
    safeSendToWebContents(dock.webContents, channel, payload);
  }
}
