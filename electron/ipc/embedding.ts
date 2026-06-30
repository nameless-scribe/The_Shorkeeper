import { ipcMain } from 'electron';
import {
  getEmbeddingSettingsInfo,
  saveEmbeddingSettings,
} from '../../src/models/embedding-config';
import type { EmbeddingSettingsPatch } from '../../src/shared/types';

export function registerEmbeddingIpc(): void {
  ipcMain.handle('embedding:getSettings', () => getEmbeddingSettingsInfo());

  ipcMain.handle('embedding:setSettings', (_event, patch: EmbeddingSettingsPatch) =>
    saveEmbeddingSettings(patch),
  );
}
