import { BrowserWindow } from 'electron';
import { trustedIpcMain as ipcMain } from './trusted-ipc';
import {
  getDockPreferences,
  setDockAlwaysOnTop,
  setDockPositionLocked,
} from '../dock/preferences';
import { openChatFromDock, openScheduleFromDock, openStatusFromDock, refreshDockPreferences } from '../windows/dock';
import { requireBoolean, requireFiniteNumber } from '../../src/shared/ipc-validation';

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

  ipcMain.handle('dock:setAlwaysOnTop', (_event, enabled: unknown) => {
    setDockAlwaysOnTop(requireBoolean(enabled, 'alwaysOnTop'));
    return refreshDockPreferences();
  });

  ipcMain.handle('dock:setPositionLocked', (_event, locked: unknown) => {
    setDockPositionLocked(requireBoolean(locked, 'positionLocked'));
    return refreshDockPreferences();
  });

  ipcMain.handle('dock:moveBy', (event, rawDx: unknown, rawDy: unknown) => {
    if (getDockPreferences().positionLocked) {
      return { ok: false, reason: 'locked' };
    }

    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { ok: false };

    const dx = requireFiniteNumber(rawDx, 'dx', { min: -10_000, max: 10_000 });
    const dy = requireFiniteNumber(rawDy, 'dy', { min: -10_000, max: 10_000 });
    const [x, y] = win.getPosition();
    win.setPosition(Math.round(x + dx), Math.round(y + dy));
    return { ok: true };
  });
}
