import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { app, BrowserWindow } from 'electron';
import { configureSkillsPaths } from '../src/skills/paths';
import { configureDbRuntime } from '../src/db/runtime-paths';
import { bootstrapDataLayout } from '../src/config/bootstrap-data-layout';
import { registerAgentIpc } from './ipc/agent';
import { registerSessionIpc } from './ipc/session';
import { registerProfileIpc } from './ipc/profile';
import { registerWorldbookIpc } from './ipc/worldbook';
import { registerStatsIpc } from './ipc/stats';
import { registerPresenceIpc } from './ipc/presence';
import { registerWindowIpc } from './ipc/window';
import { registerTasksIpc } from './ipc/tasks';
import { initDatabase, closeDatabase } from '../src/db';
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
import { registerDocumentsIpc } from './ipc/documents';
import { registerEmbeddingIpc } from './ipc/embedding';
import { registerMcpIpc, initMcpOnStartup } from './ipc/mcp';
import { registerSkillsIpc } from './ipc/skills';
import { registerModelIpc } from './ipc/model';
import { registerPerformanceIpc } from './ipc/performance';
import { registerPluginsIpc } from './ipc/plugins';
import { registerPermissionIpc, requestPermissionConfirm } from './ipc/permission';
import { setPermissionConfirmer } from '../src/agent/permissions';
import { reloadScheduler, startScheduler, stopScheduler } from './scheduler/cron';
import { broadcastTasksUpdated } from './tasks/events';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

config({ path: path.join(process.cwd(), '.env') });

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
  const layout = bootstrapDataLayout(app.getPath('userData'));
  if (layout.usedFallback) {
    console.warn(
      `[data] 无法在 D:\\SQLlite 创建数据目录（${layout.fallbackReason ?? '未知原因'}），已改用 ${layout.databaseDir}`,
    );
  } else {
    console.info(`[data] 数据目录: ${layout.databaseDir}`);
  }

  try {
    await initDatabase();
    restoreActiveSession();
  } catch (err) {
    console.error('数据库初始化失败:', err);
  }

  registerAgentIpc();
  registerSessionIpc();
  registerProfileIpc();
  registerWorldbookIpc();
  registerStatsIpc();
  registerPresenceIpc();
  registerWindowIpc();
  registerTasksIpc();
  registerWorkspaceIpc();
  registerDockIpc();
  registerDocumentsIpc();
  registerEmbeddingIpc();
  registerMcpIpc();
  registerSkillsIpc();
  registerModelIpc();
  registerPerformanceIpc();
  registerPluginsIpc();
  registerPermissionIpc();
  setPermissionConfirmer(requestPermissionConfirm);

  await initMcpOnStartup().catch((err) => {
    console.error('[mcp] 启动加载失败:', err);
  });

  setTaskChangeHandler(() => {
    reloadScheduler();
    broadcastTasksUpdated();
  });

  createTray();

  const manager = getWindowManager();
  attachTrayCloseBehavior(manager.create('chat'));
  for (const kind of ['status', 'schedule'] as const) {
    attachTrayCloseBehavior(manager.create(kind, { showOnReady: false }));
  }

  attachMainPanelDockSync();
  syncDockVisibility();

  emitInitialState();
  startScheduler();
});

app.on('window-all-closed', () => {
  if (shouldMinimizeToTray()) {
    hideAllWindowsToTray();
    return;
  }
  if (process.platform !== 'darwin') {
    stopScheduler();
    closeDatabase();
    app.quit();
  }
});

app.on('before-quit', () => {
  setAppQuitting();
  stopScheduler();
  closeDatabase();
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
