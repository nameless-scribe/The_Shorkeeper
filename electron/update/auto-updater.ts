import { createRequire } from 'node:module';
import { app, dialog } from 'electron';
import type { AppUpdater } from 'electron-updater';
import type { UpdateInfo as SharedUpdateInfo } from '../../src/shared/types';
import { isAppQuitting, setAppQuitting } from '../tray';
import { broadcastToAllRendererWindows } from '../windows/broadcast';

declare const __SIGNED_UPDATE_BUILD__: boolean;

const require = createRequire(import.meta.url);
const STARTUP_CHECK_DELAY_MS = 8_000;

let autoUpdater: AppUpdater | null = null;
let startupCheckTimer: ReturnType<typeof setTimeout> | null = null;
let removeUpdaterListeners: (() => void) | null = null;

function getAutoUpdater(): AppUpdater {
  if (!autoUpdater) {
    autoUpdater = require('electron-updater').autoUpdater as AppUpdater;
  }
  return autoUpdater;
}

let currentState: SharedUpdateInfo = { status: 'idle' };

function isSecureAutoUpdateEnabled(): boolean {
  return (
    process.platform === 'win32' &&
    typeof __SIGNED_UPDATE_BUILD__ !== 'undefined' &&
    __SIGNED_UPDATE_BUILD__
  );
}

function broadcastState(): void {
  broadcastToAllRendererWindows('update:status', currentState);
}

function setState(partial: Partial<SharedUpdateInfo>): void {
  currentState = { ...currentState, ...partial };
  broadcastState();
}

export function getUpdateState(): SharedUpdateInfo {
  return currentState;
}

export function quitAndInstallUpdate(): void {
  if (!app.isPackaged || !isSecureAutoUpdateEnabled()) return;
  setAppQuitting();
  getAutoUpdater().quitAndInstall(false, true);
}

export async function checkForAppUpdates(): Promise<SharedUpdateInfo> {
  if (!app.isPackaged) {
    return {
      status: 'not-available',
      error: '开发模式不支持检查更新，请使用打包后的安装版。',
    };
  }
  if (!isSecureAutoUpdateEnabled()) {
    return {
      status: 'not-available',
      error: '当前安装包未启用安全自动更新：Windows 发布包必须先配置代码签名证书。',
    };
  }

  try {
    setState({ status: 'checking', error: undefined });
    await getAutoUpdater().checkForUpdates();
    return currentState;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setState({ status: 'error', error: message });
    return currentState;
  }
}

function attachAutoUpdaterListeners(updater: AppUpdater): () => void {
  const onChecking = () => {
    setState({ status: 'checking', error: undefined });
  };

  const onAvailable = (info: { version: string }) => {
    setState({
      status: 'available',
      version: info.version,
      progress: 0,
      error: undefined,
    });
  };

  const onNotAvailable = (info: { version: string }) => {
    setState({
      status: 'not-available',
      version: info.version,
      progress: undefined,
      error: undefined,
    });
  };

  const onDownloadProgress = (progress: { percent: number }) => {
    setState({
      status: 'downloading',
      progress: Math.round(progress.percent),
    });
  };

  const onDownloaded = (info: { version: string }) => {
    setState({
      status: 'downloaded',
      version: info.version,
      progress: 100,
      error: undefined,
    });

    void dialog
      .showMessageBox({
        type: 'info',
        title: 'The Shorekeeper — 更新已就绪',
        message: `新版本 ${info.version} 已下载完成`,
        detail: '重启应用以完成安装。你的对话与设置不会丢失。',
        buttons: ['立即重启', '稍后'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0 && !isAppQuitting()) {
          quitAndInstallUpdate();
        }
      })
      .catch((error) => {
        if (!isAppQuitting()) console.error('[update] 更新对话框失败:', error);
      });
  };

  const onError = (err: Error) => {
    setState({
      status: 'error',
      error: err.message,
    });
  };

  updater.on('checking-for-update', onChecking);
  updater.on('update-available', onAvailable);
  updater.on('update-not-available', onNotAvailable);
  updater.on('download-progress', onDownloadProgress);
  updater.on('update-downloaded', onDownloaded);
  updater.on('error', onError);

  return () => {
    updater.removeListener('checking-for-update', onChecking);
    updater.removeListener('update-available', onAvailable);
    updater.removeListener('update-not-available', onNotAvailable);
    updater.removeListener('download-progress', onDownloadProgress);
    updater.removeListener('update-downloaded', onDownloaded);
    updater.removeListener('error', onError);
  };
}

export function initAutoUpdater(): void {
  if (!app.isPackaged) {
    console.info('[update] 开发模式，跳过自动更新');
    return;
  }
  if (!isSecureAutoUpdateEnabled()) {
    console.warn('[update] 当前 Windows 构建未配置代码签名，已禁用自动更新');
    return;
  }

  const updater = getAutoUpdater();
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.allowDowngrade = false;

  if (removeUpdaterListeners) return;
  removeUpdaterListeners = attachAutoUpdaterListeners(updater);

  startupCheckTimer = setTimeout(() => {
    startupCheckTimer = null;
    if (isAppQuitting()) return;
    void checkForAppUpdates().catch((err) => {
      console.error('[update] 启动检查失败:', err);
    });
  }, STARTUP_CHECK_DELAY_MS);
}

export function shutdownAutoUpdaterRuntime(): void {
  if (startupCheckTimer) {
    clearTimeout(startupCheckTimer);
    startupCheckTimer = null;
  }
  removeUpdaterListeners?.();
  removeUpdaterListeners = null;
}
