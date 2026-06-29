import path from 'node:path';
import { app, Menu, Tray, nativeImage } from 'electron';
import { getWindowManager } from './windows/manager';
import { syncDockVisibility } from './dock/visibility';
import { showChatWindow } from './windows/chat';
import { showStatusWindow } from './windows/status';
import { showScheduleWindow } from './windows/schedule';

let tray: Tray | null = null;

function resolveTrayIcon(): Electron.NativeImage {
  const candidates = [
    path.join(process.cwd(), 'public', 'keeper-avatar.png'),
    path.join(app.getAppPath(), 'public', 'keeper-avatar.png'),
    path.join(process.cwd(), 'dist', 'keeper-avatar.png'),
  ];

  for (const file of candidates) {
    const image = nativeImage.createFromPath(file);
    if (!image.isEmpty()) {
      return image.resize({ width: 16, height: 16 });
    }
  }

  // 16×16 青色圆点 fallback
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="7" fill="#30BCED"/></svg>';
  return nativeImage.createFromBuffer(Buffer.from(svg)).resize({ width: 16, height: 16 });
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
        tray?.destroy();
        tray = null;
        app.exit(0);
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

export function hideAllWindowsToTray(): void {
  const manager = getWindowManager();
  for (const win of manager.getAllWindows()) {
    win.hide();
  }
  syncDockVisibility();
}

export function shouldMinimizeToTray(): boolean {
  return tray !== null;
}
