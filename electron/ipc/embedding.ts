import { trustedIpcMain as ipcMain } from './trusted-ipc';
import {
  getEmbeddingSettingsInfo,
  saveEmbeddingSettings,
} from '../../src/models/embedding-config';
import { testEmbeddingConnection } from '../../src/rag/embedding';
import type { EmbeddingSettingsPatch } from '../../src/shared/types';
import { parseEmbeddingSettingsPatch } from '../../src/shared/ipc-validation';

export function registerEmbeddingIpc(): void {
  ipcMain.handle('embedding:getSettings', () => getEmbeddingSettingsInfo());

  ipcMain.handle('embedding:setSettings', (_event, patch: EmbeddingSettingsPatch) =>
    saveEmbeddingSettings(parseEmbeddingSettingsPatch(patch)),
  );

  ipcMain.handle('embedding:test', () => testEmbeddingConnection());
}
