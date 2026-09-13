import { trustedIpcMain as ipcMain } from './trusted-ipc';
import {
  getPersonaSettings,
  resetPersona,
  setPersona,
} from '../../src/config/persona';
import type { PersonaSettingsPatch } from '../../src/shared/types';
import { requireRecord, requireString } from '../../src/shared/ipc-validation';

export function registerPersonaIpc(): void {
  ipcMain.handle('persona:get', () => getPersonaSettings());

  ipcMain.handle('persona:set', (_event, patch: PersonaSettingsPatch) => {
    try {
      const input = requireRecord(patch, '人设设置');
      return setPersona({
        systemPrompt: input.systemPrompt === undefined
          ? undefined
          : requireString(input.systemPrompt, '人设内容', { maxLength: 100_000 }),
        displayName: input.displayName === undefined
          ? undefined
          : requireString(input.displayName, '显示名称', { allowEmpty: true, maxLength: 200 }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(message);
    }
  });

  ipcMain.handle('persona:reset', () => resetPersona());
}
