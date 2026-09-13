import { trustedIpcMain as ipcMain } from './trusted-ipc';
import {
  createWorldbookEntry,
  deleteWorldbookEntry,
  listWorldbookEntries,
  updateWorldbookEntry,
} from '../../src/memory/worldbook';
import {
  requireBoolean,
  requireFiniteNumber,
  requireRecord,
  requireString,
} from '../../src/shared/ipc-validation';

function parseWorldbookInput(value: unknown, partial = false) {
  const input = requireRecord(value, 'Worldbook 参数');
  return {
    keys: input.keys === undefined && partial
      ? undefined
      : requireString(input.keys, '关键词', { maxLength: 10_000 }),
    content: input.content === undefined && partial
      ? undefined
      : requireString(input.content, '内容', { maxLength: 100_000 }),
    priority: input.priority === undefined
      ? undefined
      : requireFiniteNumber(input.priority, '优先级', { min: -1_000, max: 1_000 }),
    enabled: input.enabled === undefined
      ? undefined
      : requireBoolean(input.enabled, 'enabled'),
  };
}

function parseWorldbookCreateInput(value: unknown) {
  const parsed = parseWorldbookInput(value);
  return {
    ...parsed,
    keys: parsed.keys!,
    content: parsed.content!,
  };
}

export function registerWorldbookIpc() {
  ipcMain.handle('worldbook:list', () => listWorldbookEntries(true));

  ipcMain.handle(
    'worldbook:create',
    (
      _event,
      input: { keys: string; content: string; priority?: number; enabled?: boolean },
    ) => createWorldbookEntry(parseWorldbookCreateInput(input)),
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
      const updated = updateWorldbookEntry(
        requireString(id, 'Worldbook ID', { maxLength: 200 }),
        parseWorldbookInput(patch, true),
      );
      if (!updated) {
        throw new Error('Worldbook 条目不存在');
      }
      return updated;
    },
  );

  ipcMain.handle('worldbook:delete', (_event, id: string) => {
    const deleted = deleteWorldbookEntry(requireString(id, 'Worldbook ID', { maxLength: 200 }));
    return { ok: deleted };
  });
}
