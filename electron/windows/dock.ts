import { BrowserWindow, screen } from 'electron';
import { getJsonSetting, setJsonSetting } from '../../src/db/app-settings';
import type { WindowBounds } from '../../src/db/schema';
import { getPreloadPath, getRendererIndexPath } from '../paths';
import { clampBoundsToWorkArea } from './bounds';
import { getWindowManager } from './manager';
import { getDockPreferences, type DockPreferences } from '../dock/preferences';

const DOCK_WIDTH = 300;
const DOCK_HEIGHT = 188;
const BOUNDS_KEY = 'window.bounds.dock';

let dockWindow: BrowserWindow | null = null;

function defaultBounds(): WindowBounds {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + workArea.width - DOCK_WIDTH - 24,
    y: workArea.y + workArea.height - DOCK_HEIGHT - 24,
    width: DOCK_WIDTH,
    height: DOCK_HEIGHT,
  };
}

function loadDockContent(win: BrowserWindow): void {
  const query = { panel: 'dock' };
  if (process.env.VITE_DEV_SERVER_URL) {
    const params = new URLSearchParams(query);
    win.loadURL(`${process.env.VITE_DEV_SERVER_URL}?${params.toString()}`);
    return;
  }
  win.loadFile(getRendererIndexPath(), { query });
}

function saveDockBounds(win: BrowserWindow): void {
  const b = win.getBounds();
  setJsonSetting(BOUNDS_KEY, {
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
  });
}

export function getDockWindow(): BrowserWindow | null {
  if (dockWindow && !dockWindow.isDestroyed()) {
    return dockWindow;
  }
  return null;
}

function applyDockPreferences(win: BrowserWindow): void {
  const prefs = getDockPreferences();
  win.setAlwaysOnTop(prefs.alwaysOnTop, prefs.alwaysOnTop ? 'floating' : 'normal');
}

export function createDockWindow(): BrowserWindow {
  if (dockWindow && !dockWindow.isDestroyed()) {
    return dockWindow;
  }

  const saved = getJsonSetting<WindowBounds>(BOUNDS_KEY);
  const defaults = defaultBounds();
  const merged = saved
    ? { ...defaults, x: saved.x, y: saved.y, width: DOCK_WIDTH, height: DOCK_HEIGHT }
    : defaults;
  const bounds = clampBoundsToWorkArea(merged, defaults);

  if (saved && (saved.x !== bounds.x || saved.y !== bounds.y)) {
    setJsonSetting(BOUNDS_KEY, { x: bounds.x, y: bounds.y, width: DOCK_WIDTH, height: DOCK_HEIGHT });
  }

  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: DOCK_WIDTH,
    height: DOCK_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    alwaysOnTop: getDockPreferences().alwaysOnTop,
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
    backgroundColor: '#0A1128',
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  applyDockPreferences(win);

  win.on('move', () => {
    if (getDockPreferences().positionLocked) return;
    saveDockBounds(win);
  });
  win.on('closed', () => {
    if (dockWindow === win) {
      dockWindow = null;
    }
  });

  loadDockContent(win);
  dockWindow = win;
  return win;
}

export function showDockWindow(): void {
  const win = createDockWindow();
  applyDockPreferences(win);
  if (win.isVisible()) return;
  win.showInactive();
  win.webContents.send('tasks:updated', { ts: Date.now() });
}

export function refreshDockPreferences(): DockPreferences {
  const win = getDockWindow();
  if (win) {
    applyDockPreferences(win);
  }
  return getDockPreferences();
}

export function hideDockWindow(): void {
  const win = getDockWindow();
  if (!win || !win.isVisible()) return;
  win.hide();
}

export function openChatFromDock(): void {
  getWindowManager().show('chat');
}

export function openScheduleFromDock(): void {
  getWindowManager().show('schedule');
}

export function openStatusFromDock(): void {
  getWindowManager().show('status');
}
