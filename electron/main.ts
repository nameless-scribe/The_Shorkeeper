import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { app, BrowserWindow, dialog, powerMonitor } from 'electron';
import {
  registerAppearanceAssetProtocol,
  registerAppearanceAssetScheme,
} from './protocol/appearance-assets';
import { configureSkillsPaths } from '../src/skills/paths';
import { configureDbRuntime } from '../src/db/runtime-paths';
import { bootstrapDataLayout } from '../src/config/bootstrap-data-layout';
import { registerAgentIpc } from './ipc/agent';
import { registerSessionIpc } from './ipc/session';
import { registerProfileIpc } from './ipc/profile';
import { registerPersonaIpc } from './ipc/persona';
import { registerAppearanceIpc } from './ipc/appearance';
import { registerWorldbookIpc } from './ipc/worldbook';
import { registerMemoryIpc } from './ipc/memory';
import { registerStatsIpc } from './ipc/stats';
import { registerPresenceIpc } from './ipc/presence';
import { registerWindowIpc } from './ipc/window';
import { registerTasksIpc } from './ipc/tasks';
import { registerUserTasksIpc } from './ipc/user-tasks';
import { initDatabase, closeDatabaseAsync } from '../src/db';
import { setDatabaseReady } from '../src/db/state';
import { restoreActiveSession } from '../src/session/active';
import {
  createTray,
  hideAllWindowsToTray,
  isAppQuitting,
  setAppQuitting,
  shouldMinimizeToTray,
} from './tray';
import { attachMainPanelDockSync, syncDockVisibility } from './dock/visibility';
import { getWindowManager } from './windows/manager';
import { emitInitialState } from './state/presence';
import { setTaskChangeHandler } from '../src/scheduler/task-events';
import { registerWorkspaceIpc } from './ipc/workspace';
import { registerDockIpc } from './ipc/dock';
import { registerDocumentsIpc, shutdownDocumentsRuntime } from './ipc/documents';
import { registerEmbeddingIpc } from './ipc/embedding';
import { registerMcpIpc, initMcpOnStartup } from './ipc/mcp';
import { registerSkillsIpc } from './ipc/skills';
import { registerModelIpc } from './ipc/model';
import { registerPerformanceIpc } from './ipc/performance';
import { registerPluginsIpc } from './ipc/plugins';
import { registerWebSearchIpc } from './ipc/web-search';
import { registerVoiceIpc, shutdownVoiceRuntime } from './ipc/voice';
import { registerPermissionIpc, requestPermissionConfirm } from './ipc/permission';
import { registerUpdateIpc } from './ipc/update';
import { initAutoUpdater, shutdownAutoUpdaterRuntime } from './update/auto-updater';
import { configureAppIdentity } from './app-icon';
import { showSplashWindow, closeSplashWindow } from './windows/splash';
import { setPermissionConfirmer } from '../src/agent/permissions';
import { shutdownPendingSessionWork } from '../src/agent/session-background';
import {
  abortAllSessionRuns,
  awaitSessionRunsIdle,
  beginSessionRunShutdown,
} from '../src/agent/session-run-lock';
import { cancelAllPendingPermissions } from './ipc/permission';
import { reloadScheduler, startScheduler, stopScheduler } from './scheduler/cron';
import { broadcastTasksUpdated } from './tasks/events';
import { coordinateRuntimeShutdown } from '../src/runtime/shutdown-coordinator';
import { bindPowerLifecycle } from '../src/runtime/power-lifecycle';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnvFiles(): void {
  const candidates = [
    path.join(process.cwd(), '.env'),
    path.join(app.getPath('userData'), '.env'),
    path.join(app.getAppPath(), '.env'),
  ];
  for (const envPath of candidates) {
    config({ path: envPath, override: false });
  }
}

configureSkillsPaths({
  isPackaged: app.isPackaged,
  appPath: app.getAppPath(),
  resourcesPath: process.resourcesPath,
});

configureDbRuntime({
  isPackaged: app.isPackaged,
  appPath: app.getAppPath(),
  resourcesPath: process.resourcesPath,
});

registerAppearanceAssetScheme();

configureAppIdentity();

const SPLASH_MIN_MS = 2200;
const SHUTDOWN_GRACE_MS = 5000;
let shutdownReady = false;
let shutdownPromise: Promise<void> | null = null;
let startupSplashFallbackTimer: ReturnType<typeof setTimeout> | null = null;
let startupVisibilityTimer: ReturnType<typeof setTimeout> | null = null;
let removePowerLifecycle: (() => void) | null = null;

function clearStartupTimers(): void {
  if (startupSplashFallbackTimer) clearTimeout(startupSplashFallbackTimer);
  if (startupVisibilityTimer) clearTimeout(startupVisibilityTimer);
  startupSplashFallbackTimer = null;
  startupVisibilityTimer = null;
  removePowerLifecycle?.();
  removePowerLifecycle = null;
}

async function settleRuntimeForShutdown(): Promise<void> {
  const result = await coordinateRuntimeShutdown({
    beginSessionRunShutdown,
    cancelAllPendingPermissions,
    abortAllSessionRuns,
    shutdownVoiceRuntime,
    shutdownAutoUpdaterRuntime,
    clearStartupTimers,
    awaitSessionRunsIdle,
    shutdownPendingSessionWork,
    shutdownDocumentsRuntime,
    closeDatabase: closeDatabaseAsync,
  }, SHUTDOWN_GRACE_MS);
  if (!result.runsIdle || !result.backgroundIdle || !result.ragIdle) {
    console.warn('[shutdown] 部分运行时任务未在宽限期内结束，将继续关闭数据库');
  }
  for (const error of result.errors) {
    console.error(`[shutdown] 清理失败: ${error}`);
  }
  if (!result.databaseClosed) {
    console.error('[shutdown] 数据库未能完成关闭');
  }
}

function attachTrayCloseBehavior(win: BrowserWindow): void {
  win.on('close', (event) => {
    if (isAppQuitting()) return;
    if (shouldMinimizeToTray()) {
      event.preventDefault();
      getWindowManager().hideWindow(win);
    }
  });
}

app.whenReady().then(async () => {
  registerAppearanceAssetProtocol();
  showSplashWindow();
  const splashStartedAt = Date.now();

  loadEnvFiles();
  const layout = bootstrapDataLayout(app.getPath('userData'));
  if (layout.usedFallback) {
    console.warn(
      `[data] 无法在首选数据目录创建文件（${layout.fallbackReason ?? '未知原因'}），已改用 ${layout.databaseDir}`,
    );
  } else {
    console.info(`[data] 数据目录: ${layout.databaseDir}`);
  }

  let databaseOk = false;
  try {
    await initDatabase();
    restoreActiveSession();
    databaseOk = true;
    setDatabaseReady(true);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('数据库初始化失败:', err);
    setDatabaseReady(false, message);
    await dialog.showMessageBox({
      type: 'error',
      title: 'The Shorekeeper — 数据库错误',
      message: '数据库初始化失败，部分功能不可用。',
      detail: `${message}\n\n请退出应用后检查数据库健康状态和目录权限。请勿直接删除主库；必要时应从已校验备份恢复。`,
      buttons: ['继续（功能受限）', '退出'],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 1) app.quit();
    });
  }

  registerWindowIpc();
  registerPresenceIpc();
  registerUpdateIpc();

  if (databaseOk) {
    registerAgentIpc();
    registerSessionIpc();
    registerProfileIpc();
    registerPersonaIpc();
    registerAppearanceIpc();
    registerWorldbookIpc();
    registerMemoryIpc();
    registerStatsIpc();
    registerTasksIpc();
    registerUserTasksIpc();
    await registerWorkspaceIpc();
    registerDockIpc();
    await registerDocumentsIpc();
    registerEmbeddingIpc();
    registerMcpIpc();
    registerSkillsIpc();
    registerModelIpc();
    registerPerformanceIpc();
    registerPluginsIpc();
    registerWebSearchIpc();
    registerVoiceIpc();
    registerPermissionIpc();
    setPermissionConfirmer(requestPermissionConfirm);

    await initMcpOnStartup().catch((err) => {
      console.error('[mcp] 启动加载失败:', err);
    });

    setTaskChangeHandler(() => {
      reloadScheduler();
      broadcastTasksUpdated();
    });

    startScheduler();
    removePowerLifecycle = bindPowerLifecycle(powerMonitor, {
      suspend: () => stopScheduler(),
      resume: () => {
        if (isAppQuitting()) return;
        reloadScheduler();
        getWindowManager().reconcileVisibility();
      },
    });
  }

  createTray();

  const manager = getWindowManager();
  const chatWin = manager.create('chat', { showOnReady: false });
  attachTrayCloseBehavior(chatWin);

  let splashFinished = false;
  const cleanupSplashListeners = () => {
    if (!chatWin.isDestroyed()) chatWin.removeListener('ready-to-show', onStartupReady);
    if (!chatWin.webContents.isDestroyed()) {
      chatWin.webContents.removeListener('did-finish-load', onStartupReady);
    }
    if (startupSplashFallbackTimer) {
      clearTimeout(startupSplashFallbackTimer);
      startupSplashFallbackTimer = null;
    }
  };
  const finishStartupSplash = async () => {
    if (splashFinished) return;
    splashFinished = true;
    cleanupSplashListeners();

    const elapsed = Date.now() - splashStartedAt;
    const waitMs = Math.max(0, SPLASH_MIN_MS - elapsed);
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    await closeSplashWindow();
    if (!isAppQuitting()) manager.show('chat');
  };
  const onStartupReady = () => {
    void finishStartupSplash();
  };

  const scheduleStartupSplashFinish = () => {
    if (chatWin.isDestroyed()) {
      void finishStartupSplash();
      return;
    }

    chatWin.once('ready-to-show', onStartupReady);

    if (!chatWin.webContents.isLoading()) {
      void finishStartupSplash();
    } else {
      chatWin.webContents.once('did-finish-load', onStartupReady);
    }

    // 兜底：避免 ready-to-show 未触发时 Splash 一直停留
    startupSplashFallbackTimer = setTimeout(() => {
      startupSplashFallbackTimer = null;
      void finishStartupSplash();
    }, 10_000);
  };

  scheduleStartupSplashFinish();

  for (const kind of ['status', 'schedule'] as const) {
    attachTrayCloseBehavior(manager.create(kind, { showOnReady: false }));
  }

  attachMainPanelDockSync();
  syncDockVisibility();

  // 启动后若聊天窗标记为打开但实际不可见，尝试恢复（常见于换显示器或 bounds 异常）
  startupVisibilityTimer = setTimeout(() => {
    startupVisibilityTimer = null;
    if (!isAppQuitting()) getWindowManager().reconcileVisibility();
  }, 1500);

  emitInitialState();
  initAutoUpdater();
});

app.on('window-all-closed', () => {
  if (shouldMinimizeToTray()) {
    hideAllWindowsToTray();
    return;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', (event) => {
  setAppQuitting();
  stopScheduler();
  if (shutdownReady) return;

  event.preventDefault();
  if (shutdownPromise) return;

  shutdownPromise = settleRuntimeForShutdown()
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[shutdown] 运行时清理失败: ${message}`);
    })
    .finally(() => {
      shutdownReady = true;
      app.quit();
    });
});

app.on('activate', () => {
  if (managerHasVisibleWindows()) {
    return;
  }
  getWindowManager().show('chat');
});

function managerHasVisibleWindows(): boolean {
  return getWindowManager().isAnyPanelShown();
}
