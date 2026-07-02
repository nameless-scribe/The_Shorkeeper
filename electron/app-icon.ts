import { app } from 'electron';
import { resolvePackagedDistAsset } from './paths';

const ICON_FILENAME = 'tethys-emblem.png';

/** 任务栏 / 窗口 / 安装包共用的应用图标路径 */
export function resolveAppIconPath(): string | undefined {
  return resolvePackagedDistAsset(ICON_FILENAME);
}

export function configureAppIdentity(): void {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.theshorekeeper.app');
  }
}
