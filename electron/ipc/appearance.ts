import { ipcMain, dialog } from 'electron';
import {
  getAppearanceSettings,
  setAppearancePreset,
  setBackgroundFit,
  setVeilOpacity,
} from '../../src/config/appearance';
import {
  clearAppearanceAsset,
  importAvatarAsset,
  importBackgroundAsset,
} from '../../src/config/appearance-assets';
import type { AppearanceAssetSlot, AppearanceSettingsInfo } from '../../src/shared/types';
import { broadcastToAllRendererWindows } from '../windows/broadcast';

const IMAGE_FILTERS = [
  { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
];

function broadcastAppearance(): AppearanceSettingsInfo {
  const info = getAppearanceSettings();
  broadcastToAllRendererWindows('appearance:changed', info);
  return info;
}

async function pickImagePath(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: IMAGE_FILTERS,
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0];
}

export function registerAppearanceIpc(): void {
  ipcMain.handle('appearance:get', () => getAppearanceSettings());

  ipcMain.handle('appearance:setPreset', (_event, presetId: string) => {
    setAppearancePreset(presetId);
    return broadcastAppearance();
  });

  ipcMain.handle('appearance:setVeilOpacity', (_event, opacity: number) => {
    setVeilOpacity(opacity);
    return broadcastAppearance();
  });

  ipcMain.handle('appearance:setBackgroundFit', (_event, fit: string) => {
    setBackgroundFit(fit === 'contain' ? 'contain' : 'cover');
    return broadcastAppearance();
  });

  ipcMain.handle('appearance:pickBackground', async () => {
    const source = await pickImagePath();
    if (!source) return null;
    importBackgroundAsset(source);
    return broadcastAppearance();
  });

  ipcMain.handle('appearance:importBackground', (_event, sourcePath: string) => {
    importBackgroundAsset(sourcePath);
    return broadcastAppearance();
  });

  ipcMain.handle('appearance:pickKeeperAvatar', async () => {
    const source = await pickImagePath();
    if (!source) return null;
    importAvatarAsset(source, 'keeperAvatar');
    return broadcastAppearance();
  });

  ipcMain.handle('appearance:pickUserAvatar', async () => {
    const source = await pickImagePath();
    if (!source) return null;
    importAvatarAsset(source, 'userAvatar');
    return broadcastAppearance();
  });

  ipcMain.handle('appearance:clearAsset', (_event, slot: AppearanceAssetSlot) => {
    clearAppearanceAsset(slot);
    return broadcastAppearance();
  });
}
