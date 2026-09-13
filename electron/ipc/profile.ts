import { trustedIpcMain as ipcMain } from './trusted-ipc';
import {
  deleteProfileKey,
  listProfileEntries,
  setProfileValue,
} from '../../src/memory/user-profile';
import { requireString } from '../../src/shared/ipc-validation';

export function registerProfileIpc() {
  ipcMain.handle('profile:list', () => listProfileEntries());

  ipcMain.handle('profile:set', (_event, key: string, value: string) => {
    setProfileValue(
      requireString(key, '画像键', { maxLength: 200 }),
      requireString(value, '画像值', { maxLength: 100_000 }),
    );
    return { ok: true };
  });

  ipcMain.handle('profile:delete', (_event, key: string) => {
    const deleted = deleteProfileKey(requireString(key, '画像键', { maxLength: 200 }));
    return { ok: deleted };
  });
}
