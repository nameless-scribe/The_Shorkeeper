import { getErpSettingsInfo, saveErpSettings } from '../../src/config/erp';
import type { ErpSettingsInfo, ErpSettingsPatch } from '../../src/shared/types';
import { requireBoolean, requireEnum, requireRecord, requireString } from '../../src/shared/ipc-validation';
import { getErpConnectionService } from '../erp/service';
import { trustedIpcMain as ipcMain } from './trusted-ipc';

function parseErpSettingsPatch(raw: unknown): ErpSettingsPatch {
  const input = requireRecord(raw, 'ERP 设置');
  const patch: ErpSettingsPatch = {};
  if (input.enabled !== undefined) patch.enabled = requireBoolean(input.enabled, 'enabled');
  if (input.origin !== undefined) patch.origin = requireString(input.origin, 'origin', { allowEmpty: true, maxLength: 2_048 });
  if (input.apiPrefix !== undefined) patch.apiPrefix = requireString(input.apiPrefix, 'apiPrefix', { allowEmpty: true, maxLength: 101 });
  if (input.browserChannel !== undefined) patch.browserChannel = requireEnum(input.browserChannel, 'browserChannel', ['msedge', 'chrome'] as const);
  if (input.username !== undefined) patch.username = requireString(input.username, 'username', { allowEmpty: true, maxLength: 200 });
  if (input.password !== undefined) patch.password = requireString(input.password, 'password', { allowEmpty: true, maxLength: 1_000 });
  if (input.clearCredentials !== undefined) patch.clearCredentials = requireBoolean(input.clearCredentials, 'clearCredentials');
  return patch;
}

export function registerErpIpc(): void {
  ipcMain.handle('erp:getSettings', (): ErpSettingsInfo => getErpSettingsInfo());
  ipcMain.handle('erp:saveSettings', async (_event, raw: unknown): Promise<ErpSettingsInfo> => {
    await getErpConnectionService().disconnect();
    return saveErpSettings(parseErpSettingsPatch(raw));
  });
  ipcMain.handle('erp:connect', () => getErpConnectionService().connect());
  ipcMain.handle('erp:refresh', () => getErpConnectionService().refresh());
  ipcMain.handle('erp:bringToFront', () => getErpConnectionService().bringToFront());
  ipcMain.handle('erp:disconnect', () => getErpConnectionService().disconnect());
  ipcMain.handle('erp:status', () => getErpConnectionService().status());
}
