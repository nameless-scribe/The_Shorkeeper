import { app, BrowserWindow } from 'electron';
import { getPreloadPath, getRendererIndexPath } from '../paths';

export function showReminderWindow(title: string, body: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 380,
    height: 280,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    center: true,
    resizable: false,
    skipTaskbar: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const query = {
    panel: 'reminder',
    title,
    body,
  };

  if (process.env.VITE_DEV_SERVER_URL) {
    const params = new URLSearchParams(query);
    win.loadURL(`${process.env.VITE_DEV_SERVER_URL}?${params.toString()}`);
  } else {
    win.loadFile(getRendererIndexPath(), { query });
  }

  win.once('ready-to-show', () => {
    if (app.isReady()) {
      app.focus({ steal: true });
    }
    win.show();
    win.focus();
    win.flashFrame(true);
  });

  win.on('focus', () => {
    win.flashFrame(false);
  });

  win.on('closed', () => {
    win.destroy();
  });

  return win;
}
