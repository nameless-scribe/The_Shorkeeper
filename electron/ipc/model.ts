import { trustedIpcMain as ipcMain } from './trusted-ipc';
import {
  createModelProfile,
  deleteModelProfile,
  getModelProfilesInfo,
  getModelProtocol,
  getModelSettingsInfo,
  setActiveModelProfile,
  setModelProtocol,
  saveModelSettings,
  updateModelProfile,
  type ModelProtocol,
} from '../../src/models/config';
import type {
  ModelProfileInput,
  ModelProfilePatch,
  ModelSettingsPatch,
} from '../../src/shared/types';
import { emitInitialState } from '../state/presence';
import { abortAllPendingSessionWork } from '../../src/agent/session-background';
import {
  parseModelProfileInput,
  parseModelProfilePatch,
  parseModelProtocol,
  parseModelSettingsPatch,
  requireString,
} from '../../src/shared/ipc-validation';

function notifyModelConfigChanged(): void {
  abortAllPendingSessionWork();
  emitInitialState();
}

export function registerModelIpc(): void {
  ipcMain.handle('model:getProtocol', (): ModelProtocol => getModelProtocol());

  ipcMain.handle('model:setProtocol', (_event, protocol: unknown) => {
    const value = setModelProtocol(parseModelProtocol(protocol));
    notifyModelConfigChanged();
    return value;
  });

  ipcMain.handle('model:getSettings', () => getModelSettingsInfo());

  ipcMain.handle('model:setSettings', (_event, patch: ModelSettingsPatch) => {
    const result = saveModelSettings(parseModelSettingsPatch(patch));
    notifyModelConfigChanged();
    return result;
  });

  ipcMain.handle('model:getProfiles', () => getModelProfilesInfo());

  ipcMain.handle('model:createProfile', (_event, input: ModelProfileInput) => {
    const result = createModelProfile(parseModelProfileInput(input));
    notifyModelConfigChanged();
    return result;
  });

  ipcMain.handle('model:updateProfile', (_event, id: string, patch: ModelProfilePatch) => {
    const result = updateModelProfile(
      requireString(id, '模型配置 ID', { maxLength: 200 }),
      parseModelProfilePatch(patch),
    );
    notifyModelConfigChanged();
    return result;
  });

  ipcMain.handle('model:deleteProfile', (_event, id: string) => {
    const result = deleteModelProfile(requireString(id, '模型配置 ID', { maxLength: 200 }));
    notifyModelConfigChanged();
    return result;
  });

  ipcMain.handle('model:setActiveProfile', (_event, id: string) => {
    const result = setActiveModelProfile(requireString(id, '模型配置 ID', { maxLength: 200 }));
    notifyModelConfigChanged();
    return result;
  });
}
