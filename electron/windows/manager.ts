import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron';
import { getJsonSetting, setJsonSetting } from '../../src/db/app-settings';
import type { WindowBounds } from '../../src/db/schema';
import { syncDockVisibility } from '../dock/visibility';
import { resolveAppIconPath } from '../app-icon';
import { getPreloadPath, getRendererIndexPath } from '../paths';
import { clampBoundsToWorkArea } from './bounds';
import { hideWindowToTray, showWindowFromTray } from '../tray';
import {
  attachRendererNavigationGuards,
  getTrustedDevServerUrl,
} from './security';
import { safeSendToWebContents, sendWhenWebContentsReady } from './web-contents';

export type WindowKind = 'chat' | 'status' | 'schedule' | 'call';

export interface CreateWindowOptions {
  /** 内容就绪后是否显示；默认 true */
  showOnReady?: boolean;
}

const BOUNDS_KEYS: Record<WindowKind, string> = {
  chat: 'window.bounds.chat',
  status: 'window.bounds.status',
  schedule: 'window.bounds.schedule',
  call: 'window.bounds.call',
};

const DEFAULT_BOUNDS: Record<WindowKind, WindowBounds> = {
  chat: { x: 80, y: 60, width: 420, height: 720 },
  status: { x: 520, y: 80, width: 300, height: 440 },
  schedule: { x: 840, y: 100, width: 360, height: 520 },
  call: { x: 200, y: 100, width: 360, height: 580 },
};

function loadWindowContent(win: BrowserWindow, kind: WindowKind): void {
  const devServerUrl = getTrustedDevServerUrl();
  if (devServerUrl) {
    const base = devServerUrl;
    const url = kind === 'chat' ? base : `${base}?panel=${kind}`;
    void win.loadURL(url).catch((error) => {
      if (!win.isDestroyed()) console.error(`[window] ${kind} 页面加载失败:`, error);
    });
    return;
  }
  const indexHtml = getRendererIndexPath();
  if (kind === 'chat') {
    void win.loadFile(indexHtml).catch((error) => {
      if (!win.isDestroyed()) console.error(`[window] ${kind} 页面加载失败:`, error);
    });
  } else {
    void win.loadFile(indexHtml, { query: { panel: kind } }).catch((error) => {
      if (!win.isDestroyed()) console.error(`[window] ${kind} 页面加载失败:`, error);
    });
  }
}

function baseOptions(kind: WindowKind): BrowserWindowConstructorOptions {
  const saved = getJsonSetting<Partial<WindowBounds>>(BOUNDS_KEYS[kind]);
  const defaults = DEFAULT_BOUNDS[kind];
  const bounds = clampBoundsToWorkArea(saved ?? {}, defaults);
  const iconPath = resolveAppIconPath();

  if (
    !saved ||
    saved.x !== bounds.x ||
    saved.y !== bounds.y ||
    saved.width !== bounds.width ||
    saved.height !== bounds.height
  ) {
    setJsonSetting(BOUNDS_KEYS[kind], bounds);
  }

  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    show: false,
    frame: false,
    // 保持不透明，避免 Windows 透明窗在抗锯齿边缘露黑；外轮廓交给系统原生圆角，
    // renderer 不再叠加一层更大的 CSS 圆角，以免两种半径之间露出窗口底色。
    transparent: false,
    roundedCorners: true,
    resizable: true,
    backgroundColor: '#0A1128',
    ...(iconPath ? { icon: iconPath } : {}),
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
  /** 逻辑可见状态；比 win.isVisible() 更可靠（skipTaskbar 切换时 Windows 可能不同步） */
  private readonly panelShown = new Map<WindowKind, boolean>();

  create(kind: WindowKind, createOptions: CreateWindowOptions = {}): BrowserWindow {
    const { showOnReady = true } = createOptions;
    const existing = this.windows.get(kind);
    if (existing && !existing.isDestroyed()) {
      return existing;
    }

    const windowOptions: BrowserWindowConstructorOptions = {
      ...baseOptions(kind),
      title:
        kind === 'chat'
          ? 'The Shorekeeper'
          : kind === 'status'
            ? '守岸人 · 状态'
            : kind === 'schedule'
              ? '守岸人 · 日程'
              : '守岸人 · 语音通话',
    };

    if (kind === 'chat') {
      windowOptions.minWidth = 360;
      windowOptions.minHeight = 520;
    } else if (kind === 'status') {
      windowOptions.minWidth = 260;
      windowOptions.minHeight = 360;
    } else if (kind === 'call') {
      windowOptions.minWidth = 320;
      windowOptions.minHeight = 480;
    } else {
      windowOptions.minWidth = 320;
      windowOptions.minHeight = 420;
    }

    const win = new BrowserWindow(windowOptions);
    attachRendererNavigationGuards(win);
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
    win.once('ready-to-show', () => {
      if (win.isDestroyed()) return;
      const clamped = clampBoundsToWorkArea(win.getBounds(), DEFAULT_BOUNDS[kind]);
      const current = win.getBounds();
      if (
        current.x !== clamped.x ||
        current.y !== clamped.y ||
        current.width !== clamped.width ||
        current.height !== clamped.height
      ) {
        win.setBounds(clamped);
        setJsonSetting(BOUNDS_KEYS[kind], clamped);
      }

      const shouldShow = showOnReady || this.panelShown.get(kind) === true;
      if (shouldShow) {
        this.panelShown.set(kind, true);
        showWindowFromTray(win);
      } else {
        this.panelShown.set(kind, false);
        hideWindowToTray(win);
      }
      syncDockVisibility();
    });

    return win;
  }

  getKindFromWindow(win: BrowserWindow): WindowKind | null {
    for (const [kind, tracked] of this.windows) {
      if (tracked === win) return kind;
    }
    return null;
  }

  isPanelShown(kind: WindowKind): boolean {
    return this.panelShown.get(kind) ?? false;
  }

  isAnyPanelShown(): boolean {
    for (const kind of ['chat', 'status', 'schedule'] as const) {
      if (this.isPanelShown(kind)) return true;
    }
    return false;
  }

  hideWindow(win: BrowserWindow): void {
    const kind = this.getKindFromWindow(win);
    if (kind) {
      this.hide(kind);
      return;
    }
    hideWindowToTray(win);
    syncDockVisibility();
  }

  get(kind: WindowKind): BrowserWindow | null {
    const win = this.windows.get(kind);
    if (win && !win.isDestroyed()) return win;
    return null;
  }

  show(kind: WindowKind): BrowserWindow {
    let win = this.get(kind);
    if (!win) {
      this.panelShown.set(kind, true);
      return this.create(kind, { showOnReady: true });
    }
    this.panelShown.set(kind, true);
    showWindowFromTray(win);
    syncDockVisibility();
    return win;
  }

  /** 逻辑状态与 Electron 可见性不一致时，以实际可见性为准并同步 Dock */
  reconcileVisibility(): void {
    for (const kind of ['chat', 'status', 'schedule'] as const) {
      const win = this.get(kind);
      if (!win) {
        this.panelShown.set(kind, false);
        continue;
      }
      if (this.panelShown.get(kind) && !win.isVisible()) {
        showWindowFromTray(win);
      }
    }
    syncDockVisibility();
  }

  hideAll(): void {
    for (const kind of ['chat', 'status', 'schedule'] as const) {
      const win = this.get(kind);
      if (!win) continue;
      this.panelShown.set(kind, false);
      hideWindowToTray(win);
    }
    syncDockVisibility();
  }

  destroy(kind: WindowKind): void {
    const win = this.get(kind);
    if (!win) return;
    this.panelShown.set(kind, false);
    win.destroy();
    syncDockVisibility();
  }

  hide(kind: WindowKind): void {
    const win = this.get(kind);
    if (!win) return;
    this.panelShown.set(kind, false);
    hideWindowToTray(win);
    syncDockVisibility();
  }

  toggle(kind: WindowKind): void {
    if (this.isPanelShown(kind)) {
      this.hide(kind);
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
      safeSendToWebContents(wc, channel, payload);
    }
  }

  openChatSettings(): void {
    const win = this.show('chat');
    sendWhenWebContentsReady(win.webContents, 'chat:openSettings');
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

export function createCallWindow(): BrowserWindow {
  return getWindowManager().create('call');
}
