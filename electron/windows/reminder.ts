import { app, BrowserWindow } from 'electron';
import { resolveAppIconPath } from '../app-icon';
import { getPreloadPath, getRendererIndexPath } from '../paths';
import {
  attachRendererNavigationGuards,
  getTrustedDevServerUrl,
} from './security';

export function showReminderWindow(title: string, body: string): BrowserWindow {
  const iconPath = resolveAppIconPath();
  const win = new BrowserWindow({
    width: 380,
    height: 280,
    show: false,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    center: true,
    resizable: false,
    skipTaskbar: false,
    backgroundColor: '#0A1128',
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const query = {
    panel: 'reminder',
    title,
    body,
  };

  attachRendererNavigationGuards(win);
  const devServerUrl = getTrustedDevServerUrl();
  if (devServerUrl) {
    const params = new URLSearchParams(query);
    win.loadURL(`${devServerUrl}?${params.toString()}`);
  } else {
    win.loadFile(getRendererIndexPath(), { query });
  }

  win.once('ready-to-show', () => {
    if (app.isReady()) {
      app.focus({ steal: true });
    }
    win.show();
    win.focus();
    win.flashFrame(true);
  });

  win.on('focus', () => {
    win.flashFrame(false);
  });

  win.on('closed', () => {
    win.destroy();
  });

  return win;
}
