import { BrowserWindow, ipcMain } from 'electron';
import { getWindowManager } from '../windows/manager';

function windowFromSender(sender: Electron.WebContents): BrowserWindow | null {
  return BrowserWindow.fromWebContents(sender);
}

function isReminderWindow(win: BrowserWindow): boolean {
  return win.webContents.getURL().includes('panel=reminder');
}

export function registerWindowIpc() {
  const manager = getWindowManager();

  ipcMain.handle('window:show', (_event, kind: 'chat' | 'status' | 'schedule' | 'call') => {
    manager.show(kind);
    return { ok: true };
  });

  ipcMain.handle('window:hide', (_event, kind: 'chat' | 'status' | 'schedule' | 'call') => {
    manager.hide(kind);
    return { ok: true };
  });

  ipcMain.handle('window:openSettings', () => {
    manager.openChatSettings();
    return { ok: true };
  });

  ipcMain.handle('window:destroyCall', () => {
    manager.destroy('call');
    return { ok: true };
  });

  ipcMain.on('window:moveBy', (event, dx: unknown, dy: unknown) => {
    if (typeof dx !== 'number' || typeof dy !== 'number') return;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;

    const win = windowFromSender(event.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();

    const [x, y] = win.getPosition();
    win.setPosition(Math.round(x + dx), Math.round(y + dy));
  });

  ipcMain.on('window:minimize', (event) => {
    const win = windowFromSender(event.sender);
    if (!win) return;
    manager.hideWindow(win);
  });

  ipcMain.on('window:close', (event) => {
    const win = windowFromSender(event.sender);
    if (!win) return;
    if (isReminderWindow(win)) {
      win.destroy();
      return;
    }
    manager.hideWindow(win);
  });
}
