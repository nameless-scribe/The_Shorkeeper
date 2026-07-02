import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron';
import { getWindowManager } from './windows/manager';
import { syncDockVisibility } from './dock/visibility';
import { showChatWindow } from './windows/chat';
import { showStatusWindow } from './windows/status';
import { showScheduleWindow } from './windows/schedule';
import { resolvePackagedDistAsset } from './paths';

let tray: Tray | null = null;
let appQuitting = false;

const TRAY_ICON_SIZE = 16;

function fallbackTrayIcon(): Electron.NativeImage {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="7" fill="#30BCED"/></svg>';
  const fromSvg = nativeImage.createFromDataURL(
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
  );
  if (!fromSvg.isEmpty()) {
    return fromSvg.resize({ width: TRAY_ICON_SIZE, height: TRAY_ICON_SIZE });
  }
  return nativeImage
    .createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAFUlEQVR42mNk+M9Qz0AEYBxVSF+FABJqAf0Yf5o9AAAAAElFTkSuQmCC',
    )
    .resize({ width: TRAY_ICON_SIZE, height: TRAY_ICON_SIZE });
}

function resizeTrayIcon(image: Electron.NativeImage): Electron.NativeImage {
  return image.resize({
    width: TRAY_ICON_SIZE,
    height: TRAY_ICON_SIZE,
    quality: 'best',
  });
}

function loadTrayIconFromAsset(filename: string): Electron.NativeImage | null {
  const filePath = resolvePackagedDistAsset(filename);
  if (!filePath) return null;

  const image = nativeImage.createFromPath(filePath);
  if (image.isEmpty()) return null;
  return resizeTrayIcon(image);
}

function resolveTrayIcon(): Electron.NativeImage {
  const emblem = loadTrayIconFromAsset('tethys-emblem.png');
  if (emblem) return emblem;

  console.warn('[tray] 未找到 tethys-emblem.png，使用内置 fallback 图标');
  return fallbackTrayIcon();
}

function buildTrayMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: '显示聊天窗',
      click: () => showChatWindow(),
    },
    {
      label: '显示状态面板',
      click: () => showStatusWindow(),
    },
    {
      label: '显示日程面板',
      click: () => showScheduleWindow(),
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        setAppQuitting();
        tray?.destroy();
        tray = null;
        app.quit();
      },
    },
  ]);
}

export function createTray(): Tray {
  if (tray) return tray;

  tray = new Tray(resolveTrayIcon());
  tray.setToolTip('The Shorekeeper');
  tray.setContextMenu(buildTrayMenu());

  tray.on('double-click', () => {
    showChatWindow();
  });

  return tray;
}

export function refreshTrayIcon(): void {
  if (!tray || tray.isDestroyed()) return;
  tray.setImage(resolveTrayIcon());
}

export function setAppQuitting(): void {
  appQuitting = true;
}

export function isAppQuitting(): boolean {
  return appQuitting;
}

/** 隐藏到托盘：不进任务栏，不影响其它窗口 */
export function hideWindowToTray(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.setSkipTaskbar(true);
  win.hide();
}

/** 从托盘恢复：重新出现在任务栏 */
export function showWindowFromTray(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  win.setSkipTaskbar(false);
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) {
    win.show();
  }
  win.moveTop();
  win.focus();
  if (process.platform === 'win32') {
    app.focus({ steal: true });
  }
}

export function hideAllWindowsToTray(): void {
  getWindowManager().hideAll();
}

export function shouldMinimizeToTray(): boolean {
  return tray !== null && !appQuitting;
}
