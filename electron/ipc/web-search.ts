import { ipcMain } from 'electron';
import {
  getWebSearchSettingsInfo,
  saveWebSearchSettings,
} from '../../src/config/web-search-config';
import type { WebSearchSettingsInfo, WebSearchSettingsPatch } from '../../src/shared/types';

export function registerWebSearchIpc(): void {
  ipcMain.handle('web-search:getSettings', (): WebSearchSettingsInfo => getWebSearchSettingsInfo());

  ipcMain.handle(
    'web-search:saveSettings',
    (_event, patch: WebSearchSettingsPatch): WebSearchSettingsInfo =>
      saveWebSearchSettings(patch),
  );
}
