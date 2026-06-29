import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { app, BrowserWindow } from 'electron';
import { registerAgentIpc } from './ipc/agent';
import { registerSessionIpc } from './ipc/session';
import { registerProfileIpc } from './ipc/profile';
import { registerWorldbookIpc } from './ipc/worldbook';
import { registerStatsIpc } from './ipc/stats';
import { registerPresenceIpc } from './ipc/presence';
import { registerWindowIpc } from './ipc/window';
import { registerTasksIpc } from './ipc/tasks';
import { initDatabase, closeDatabase } from '../src/db';
import { createTray, hideAllWindowsToTray, shouldMinimizeToTray } from './tray';
import { createChatWindow } from './windows/chat';
import { createStatusWindow } from './windows/status';
import { createScheduleWindow } from './windows/schedule';
import { getWindowManager } from './windows/manager';
import { emitInitialState } from './state/presence';
import { startScheduler, stopScheduler } from './scheduler/cron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

config({ path: path.join(process.cwd(), '.env') });

function attachTrayCloseBehavior(win: BrowserWindow): void {
  win.on('close', (event) => {
    if (shouldMinimizeToTray()) {
      event.preventDefault();
      win.hide();
    }
  });
}

app.whenReady().then(async () => {
  try {
    await initDatabase();
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

  createTray();

  for (const win of [createChatWindow(), createStatusWindow(), createScheduleWindow()]) {
    attachTrayCloseBehavior(win);
  }

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
  return getWindowManager()
    .getAllWindows()
    .some((w) => w.isVisible());
}
