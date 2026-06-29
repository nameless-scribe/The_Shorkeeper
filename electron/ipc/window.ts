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

  ipcMain.handle('window:show', (_event, kind: 'chat' | 'status' | 'schedule') => {
    manager.show(kind);
    return { ok: true };
  });

  ipcMain.handle('window:hide', (_event, kind: 'chat' | 'status' | 'schedule') => {
    manager.hide(kind);
    return { ok: true };
  });

  ipcMain.handle('window:openSettings', () => {
    manager.openChatSettings();
    return { ok: true };
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
