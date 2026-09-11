import { ipcMain } from 'electron';
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

function notifyModelConfigChanged(): void {
  abortAllPendingSessionWork();
  emitInitialState();
}

export function registerModelIpc(): void {
  ipcMain.handle('model:getProtocol', (): ModelProtocol => getModelProtocol());

  ipcMain.handle('model:setProtocol', (_event, protocol: ModelProtocol) => {
    const value = setModelProtocol(protocol);
    notifyModelConfigChanged();
    return value;
  });

  ipcMain.handle('model:getSettings', () => getModelSettingsInfo());

  ipcMain.handle('model:setSettings', (_event, patch: ModelSettingsPatch) => {
    const result = saveModelSettings(patch);
    notifyModelConfigChanged();
    return result;
  });

  ipcMain.handle('model:getProfiles', () => getModelProfilesInfo());

  ipcMain.handle('model:createProfile', (_event, input: ModelProfileInput) => {
    const result = createModelProfile(input);
    notifyModelConfigChanged();
    return result;
  });

  ipcMain.handle('model:updateProfile', (_event, id: string, patch: ModelProfilePatch) => {
    const result = updateModelProfile(id, patch);
    notifyModelConfigChanged();
    return result;
  });

  ipcMain.handle('model:deleteProfile', (_event, id: string) => {
    const result = deleteModelProfile(id);
    notifyModelConfigChanged();
    return result;
  });

  ipcMain.handle('model:setActiveProfile', (_event, id: string) => {
    const result = setActiveModelProfile(id);
    notifyModelConfigChanged();
    return result;
  });
}
