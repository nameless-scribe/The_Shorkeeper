import { ipcMain } from 'electron';
import {
  createWorldbookEntry,
  deleteWorldbookEntry,
  listWorldbookEntries,
  updateWorldbookEntry,
} from '../../src/memory/worldbook';

export function registerWorldbookIpc() {
  ipcMain.handle('worldbook:list', () => listWorldbookEntries(true));

  ipcMain.handle(
    'worldbook:create',
    (
      _event,
      input: { keys: string; content: string; priority?: number; enabled?: boolean },
    ) => createWorldbookEntry(input),
  );

  ipcMain.handle(
    'worldbook:update',
    (
      _event,
      id: string,
      patch: {
        keys?: string;
        content?: string;
        priority?: number;
        enabled?: boolean;
      },
    ) => {
      const updated = updateWorldbookEntry(id, patch);
      if (!updated) {
        throw new Error('Worldbook 条目不存在');
      }
      return updated;
    },
  );

  ipcMain.handle('worldbook:delete', (_event, id: string) => {
    const deleted = deleteWorldbookEntry(id);
    return { ok: deleted };
  });
}
