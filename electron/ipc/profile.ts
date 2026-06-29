import { ipcMain } from 'electron';
import {
  deleteProfileKey,
  listProfileEntries,
  setProfileValue,
} from '../../src/memory/user-profile';

export function registerProfileIpc() {
  ipcMain.handle('profile:list', () => listProfileEntries());

  ipcMain.handle('profile:set', (_event, key: string, value: string) => {
    setProfileValue(key, value);
    return { ok: true };
  });

  ipcMain.handle('profile:delete', (_event, key: string) => {
    const deleted = deleteProfileKey(key);
    return { ok: deleted };
  });
}
