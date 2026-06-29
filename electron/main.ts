import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { app, BrowserWindow, ipcMain } from 'electron';
import { registerAgentIpc } from './ipc/agent';
import { registerSessionIpc } from './ipc/session';
import { registerProfileIpc } from './ipc/profile';
import { registerWorldbookIpc } from './ipc/worldbook';
import { initDatabase, closeDatabase } from '../src/db';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

config({ path: path.join(process.cwd(), '.env') });

let chatWindow: BrowserWindow | null = null;

function createChatWindow() {
  chatWindow = new BrowserWindow({
    width: 420,
    height: 720,
    minWidth: 360,
    minHeight: 520,
    title: 'The Shorekeeper',
    frame: false,
    transparent: true,
    resizable: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // sandbox 必须为 true，preload 才能以 CJS(require) 正常加载
      sandbox: true,
    },
  });

  chatWindow.on('ready-to-show', () => chatWindow?.show());

  chatWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error('Preload 加载失败:', preloadPath, error);
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    chatWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    // 开发时可按 F12 自行打开 DevTools，避免 detached 窗口干扰
  } else {
    chatWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(async () => {
  try {
    await initDatabase();
  } catch (err) {
    console.error('数据库初始化失败:', err);
  }
  registerAgentIpc(() => chatWindow);
  registerSessionIpc();
  registerProfileIpc();
  registerWorldbookIpc();

  ipcMain.on('window:minimize', () => chatWindow?.minimize());
  ipcMain.on('window:close', () => chatWindow?.close());

  createChatWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    closeDatabase();
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createChatWindow();
  }
});
