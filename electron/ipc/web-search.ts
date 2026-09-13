import { trustedIpcMain as ipcMain } from './trusted-ipc';
import {
  getWebSearchSettingsInfo,
  saveWebSearchSettings,
} from '../../src/config/web-search-config';
import type { WebSearchSettingsInfo, WebSearchSettingsPatch } from '../../src/shared/types';
import { requireRecord, requireString } from '../../src/shared/ipc-validation';

export function registerWebSearchIpc(): void {
  ipcMain.handle('web-search:getSettings', (): WebSearchSettingsInfo => getWebSearchSettingsInfo());

  ipcMain.handle(
    'web-search:saveSettings',
    (_event, patch: WebSearchSettingsPatch): WebSearchSettingsInfo =>
      saveWebSearchSettings({
        apiKey: (() => {
          const input = requireRecord(patch, '网络搜索设置');
          return input.apiKey === undefined
            ? undefined
            : requireString(input.apiKey, 'API Key', { allowEmpty: true, maxLength: 20_000 });
        })(),
      }),
  );
}
