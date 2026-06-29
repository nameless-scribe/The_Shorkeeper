import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron';
import { getJsonSetting, setJsonSetting } from '../../src/db/app-settings';
import type { WindowBounds } from '../../src/db/schema';
import { getPreloadPath, getRendererIndexPath } from '../paths';

export type WindowKind = 'chat' | 'status' | 'schedule';

const BOUNDS_KEYS: Record<WindowKind, string> = {
  chat: 'window.bounds.chat',
  status: 'window.bounds.status',
  schedule: 'window.bounds.schedule',
};

const DEFAULT_BOUNDS: Record<WindowKind, WindowBounds> = {
  chat: { x: 80, y: 60, width: 420, height: 720 },
  status: { x: 520, y: 80, width: 300, height: 440 },
  schedule: { x: 840, y: 100, width: 360, height: 520 },
};

function loadWindowContent(win: BrowserWindow, kind: WindowKind): void {
  if (process.env.VITE_DEV_SERVER_URL) {
    const base = process.env.VITE_DEV_SERVER_URL;
    const url = kind === 'chat' ? base : `${base}?panel=${kind}`;
    win.loadURL(url);
    return;
  }
  const indexHtml = getRendererIndexPath();
  if (kind === 'chat') {
    win.loadFile(indexHtml);
  } else {
    win.loadFile(indexHtml, { query: { panel: kind } });
  }
}

function baseOptions(kind: WindowKind): BrowserWindowConstructorOptions {
  const saved = getJsonSetting<WindowBounds>(BOUNDS_KEYS[kind]);
  const bounds = saved ?? DEFAULT_BOUNDS[kind];

  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
}

export class WindowManager {
  private readonly windows = new Map<WindowKind, BrowserWindow>();

  create(kind: WindowKind): BrowserWindow {
    const existing = this.windows.get(kind);
    if (existing && !existing.isDestroyed()) {
      return existing;
    }

    const options: BrowserWindowConstructorOptions = {
      ...baseOptions(kind),
      title:
        kind === 'chat'
          ? 'The Shorekeeper'
          : kind === 'status'
            ? '守岸人 · 状态'
            : '守岸人 · 日程',
    };

    if (kind === 'chat') {
      options.minWidth = 360;
      options.minHeight = 520;
    } else if (kind === 'status') {
      options.minWidth = 260;
      options.minHeight = 360;
    } else {
      options.minWidth = 320;
      options.minHeight = 420;
    }

    const win = new BrowserWindow(options);
    this.attachPersistence(win, kind);
    this.windows.set(kind, win);

    win.on('closed', () => {
      if (this.windows.get(kind) === win) {
        this.windows.delete(kind);
      }
    });

    win.webContents.on('preload-error', (_event, preloadPath, error) => {
      console.error('Preload 加载失败:', preloadPath, error);
    });

    loadWindowContent(win, kind);
    win.once('ready-to-show', () => win.show());

    return win;
  }

  get(kind: WindowKind): BrowserWindow | null {
    const win = this.windows.get(kind);
    if (win && !win.isDestroyed()) return win;
    return null;
  }

  show(kind: WindowKind): BrowserWindow {
    let win = this.get(kind);
    if (!win) {
      win = this.create(kind);
    }
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return win;
  }

  hide(kind: WindowKind): void {
    this.get(kind)?.hide();
  }

  toggle(kind: WindowKind): void {
    const win = this.get(kind);
    if (win?.isVisible()) {
      win.hide();
    } else {
      this.show(kind);
    }
  }

  getBounds(kind: WindowKind): WindowBounds | null {
    const win = this.get(kind);
    if (!win) return null;
    const b = win.getBounds();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  }

  saveBounds(kind: WindowKind): void {
    const bounds = this.getBounds(kind);
    if (bounds) {
      setJsonSetting(BOUNDS_KEYS[kind], bounds);
    }
  }

  getAllWindows(): BrowserWindow[] {
    return [...this.windows.values()].filter((w) => !w.isDestroyed());
  }

  getAllWebContents(): Electron.WebContents[] {
    return this.getAllWindows().map((w) => w.webContents);
  }

  broadcast(channel: string, payload: unknown): void {
    for (const wc of this.getAllWebContents()) {
      wc.send(channel, payload);
    }
  }

  openChatSettings(): void {
    const win = this.show('chat');
    win.webContents.send('chat:openSettings');
  }

  private attachPersistence(win: BrowserWindow, kind: WindowKind): void {
    const save = () => this.saveBounds(kind);
    win.on('move', save);
    win.on('resize', save);
  }
}

let manager: WindowManager | null = null;

export function getWindowManager(): WindowManager {
  if (!manager) {
    manager = new WindowManager();
  }
  return manager;
}

export function createChatWindow(): BrowserWindow {
  return getWindowManager().create('chat');
}

export function createStatusWindow(): BrowserWindow {
  return getWindowManager().create('status');
}

export function createScheduleWindow(): BrowserWindow {
  return getWindowManager().create('schedule');
}
