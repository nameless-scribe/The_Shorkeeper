import { ipcMain } from 'electron';
import {
  getPersonaSettings,
  resetPersona,
  setPersona,
} from '../../src/config/persona';
import type { PersonaSettingsPatch } from '../../src/shared/types';

export function registerPersonaIpc(): void {
  ipcMain.handle('persona:get', () => getPersonaSettings());

  ipcMain.handle('persona:set', (_event, patch: PersonaSettingsPatch) => {
    try {
      return setPersona(patch);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(message);
    }
  });

  ipcMain.handle('persona:reset', () => resetPersona());
}
