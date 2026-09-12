import { BrowserWindow, screen } from 'electron';
import { resolveAppIconPath } from '../app-icon';
import { getRendererIndexPath } from '../paths';
import {
  attachRendererNavigationGuards,
  getTrustedDevServerUrl,
} from './security';

const SPLASH_WIDTH = 420;
const SPLASH_HEIGHT = 320;

let splashWindow: BrowserWindow | null = null;

function centerSplashBounds(): { x: number; y: number; width: number; height: number } {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + Math.round((workArea.width - SPLASH_WIDTH) / 2),
    y: workArea.y + Math.round((workArea.height - SPLASH_HEIGHT) / 2),
    width: SPLASH_WIDTH,
    height: SPLASH_HEIGHT,
  };
}

function loadSplashContent(win: BrowserWindow): void {
  const query = { panel: 'splash' };
  const devServerUrl = getTrustedDevServerUrl();
  if (devServerUrl) {
    const params = new URLSearchParams(query);
    win.loadURL(`${devServerUrl}?${params.toString()}`);
    return;
  }
  win.loadFile(getRendererIndexPath(), { query });
}

export function showSplashWindow(): BrowserWindow {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.show();
    return splashWindow;
  }

  const iconPath = resolveAppIconPath();
  const win = new BrowserWindow({
    ...centerSplashBounds(),
    show: false,
    frame: false,
    transparent: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#0A1128',
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  attachRendererNavigationGuards(win);
  loadSplashContent(win);
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show();
  });

  splashWindow = win;
  win.on('closed', () => {
    if (splashWindow === win) splashWindow = null;
  });

  return win;
}

export async function closeSplashWindow(fadeMs = 350): Promise<void> {
  const win = splashWindow;
  splashWindow = null;

  if (!win || win.isDestroyed()) return;

  if (fadeMs > 0 && !win.webContents.isDestroyed()) {
    win.webContents
      .executeJavaScript(`document.documentElement.classList.add('splash-exiting')`, true)
      .catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, fadeMs));
  }

  if (!win.isDestroyed()) {
    win.setAlwaysOnTop(false);
    win.destroy();
  }
}

export function isSplashVisible(): boolean {
  return splashWindow !== null && !splashWindow.isDestroyed() && splashWindow.isVisible();
}
