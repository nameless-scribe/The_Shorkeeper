import { trustedIpcMain as ipcMain } from './trusted-ipc';
import {
  feedShorekeeper,
  getPresenceState,
} from '../state/presence';

export function registerPresenceIpc() {
  ipcMain.handle('presence:get', () => getPresenceState());

  ipcMain.handle('presence:feed', () => {
    feedShorekeeper();
    return { ok: true };
  });
}
