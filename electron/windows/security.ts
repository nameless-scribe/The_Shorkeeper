import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  app,
  type BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron';
import { getRendererIndexPath } from '../paths';

function loopbackDevServerUrl(): URL | null {
  if (app.isPackaged) return null;
  const raw = process.env.VITE_DEV_SERVER_URL?.trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') return null;
    return url;
  } catch {
    return null;
  }
}

export function getTrustedDevServerUrl(): string | null {
  return loopbackDevServerUrl()?.toString().replace(/\/$/, '') ?? null;
}

export function isTrustedRendererUrl(rawUrl: string): boolean {
  if (!rawUrl || rawUrl === 'about:blank') return true;

  try {
    const url = new URL(rawUrl);
    const devServer = loopbackDevServerUrl();
    if (devServer) return url.origin === devServer.origin;
    if (url.protocol === 'file:') {
      return path.resolve(fileURLToPath(url)) === path.resolve(getRendererIndexPath());
    }
    return false;
  } catch {
    return false;
  }
}

export function attachRendererNavigationGuards(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault();
  });
  win.webContents.on('will-redirect', (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault();
  });
}

export function assertTrustedIpcSender(event: IpcMainInvokeEvent | IpcMainEvent): void {
  const senderUrl = event.senderFrame?.url || event.sender.getURL();
  if (!isTrustedRendererUrl(senderUrl)) {
    throw new Error('拒绝来自非受信渲染页面的 IPC 请求');
  }
}
