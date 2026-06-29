import { BrowserWindow, ipcMain } from 'electron';
import {
  getDockPreferences,
  setDockAlwaysOnTop,
  setDockPositionLocked,
} from '../dock/preferences';
import { openChatFromDock, openScheduleFromDock, openStatusFromDock, refreshDockPreferences } from '../windows/dock';

export function registerDockIpc(): void {
  ipcMain.handle('dock:openChat', () => {
    openChatFromDock();
    return { ok: true };
  });

  ipcMain.handle('dock:openSchedule', () => {
    openScheduleFromDock();
    return { ok: true };
  });

  ipcMain.handle('dock:openStatus', () => {
    openStatusFromDock();
    return { ok: true };
  });

  ipcMain.handle('dock:getPreferences', () => getDockPreferences());

  ipcMain.handle('dock:setAlwaysOnTop', (_event, enabled: boolean) => {
    setDockAlwaysOnTop(Boolean(enabled));
    return refreshDockPreferences();
  });

  ipcMain.handle('dock:setPositionLocked', (_event, locked: boolean) => {
    setDockPositionLocked(Boolean(locked));
    return refreshDockPreferences();
  });

  ipcMain.handle('dock:moveBy', (event, dx: number, dy: number) => {
    if (getDockPreferences().positionLocked) {
      return { ok: false, reason: 'locked' };
    }

    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { ok: false };

    const [x, y] = win.getPosition();
    win.setPosition(Math.round(x + dx), Math.round(y + dy));
    return { ok: true };
  });
}
