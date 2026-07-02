import { app, ipcMain } from 'electron';
import {
  checkForAppUpdates,
  getUpdateState,
  quitAndInstallUpdate,
} from '../update/auto-updater';

export function registerUpdateIpc(): void {
  ipcMain.handle('update:getVersion', () => app.getVersion());

  ipcMain.handle('update:getStatus', () => getUpdateState());

  ipcMain.handle('update:check', () => checkForAppUpdates());

  ipcMain.handle('update:install', () => {
    quitAndInstallUpdate();
  });
}
