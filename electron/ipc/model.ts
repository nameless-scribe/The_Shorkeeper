import { ipcMain } from 'electron';
import { setSetting } from '../../src/db/app-settings';
import { getModelProtocol, MODEL_PROTOCOL_KEY, type ModelProtocol } from '../../src/models/config';

export function registerModelIpc(): void {
  ipcMain.handle('model:getProtocol', (): ModelProtocol => getModelProtocol());

  ipcMain.handle('model:setProtocol', (_event, protocol: ModelProtocol) => {
    setSetting(MODEL_PROTOCOL_KEY, protocol);
    return getModelProtocol();
  });
}
