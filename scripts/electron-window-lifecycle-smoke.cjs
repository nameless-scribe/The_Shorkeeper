const path = require('node:path');
const { app, BrowserWindow, ipcMain, webContents } = require('electron');

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

const WINDOW_CYCLES = 100;
const WINDOW_KINDS = ['chat', 'status', 'schedule', 'call'];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function createAndDestroyWindow(kind, index) {
  const size = kind === 'chat'
    ? [420, 720]
    : kind === 'status'
      ? [300, 440]
      : kind === 'schedule'
        ? [360, 520]
        : [360, 580];
  const window = new BrowserWindow({
    show: false,
    frame: false,
    width: size[0],
    height: size[1],
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  try {
    await window.loadURL('about:blank');
    await window.webContents.executeJavaScript(
      `document.title = ${JSON.stringify(`${kind}-${index}`)}`,
    );
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
  await nextTurn();
}

async function verifyRepeatedWindowLifecycle() {
  const baselineWindows = BrowserWindow.getAllWindows().length;
  const baselineContents = webContents.getAllWebContents().length;

  for (let index = 0; index < WINDOW_CYCLES; index += 1) {
    await createAndDestroyWindow(WINDOW_KINDS[index % WINDOW_KINDS.length], index);
    if ((index + 1) % 10 === 0) {
      console.log(`[electron-window-lifecycle-smoke] ${index + 1}/${WINDOW_CYCLES}`);
    }
  }
  await nextTurn();

  assert(
    BrowserWindow.getAllWindows().length === baselineWindows,
    '重复创建/销毁后遗留僵尸窗口',
  );
  assert(
    webContents.getAllWebContents().length === baselineContents,
    '重复创建/销毁后遗留 WebContents',
  );
}

async function verifyDestroyedRendererDuringInvoke() {
  const channel = 'lifecycle-smoke:delayed';
  let markStarted;
  let markFinished;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const finished = new Promise((resolve) => { markFinished = resolve; });

  ipcMain.handle(channel, async () => {
    markStarted();
    await new Promise((resolve) => setTimeout(resolve, 40));
    markFinished();
    return { ok: true };
  });

  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.resolve('scripts/electron-lifecycle-smoke-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  try {
    await window.loadURL(
      'data:text/html;charset=utf-8,%3Cmeta%20charset%3D%22utf-8%22%3E%3Ctitle%3Edestroyed-invoke%3C%2Ftitle%3E',
    );
    const bridgeReady = await window.webContents.executeJavaScript(
      `typeof window.lifecycleSmoke?.invokeDelayed === 'function'`,
    );
    assert(bridgeReady, '生命周期 smoke preload 未暴露测试桥接');
    const invoke = window.webContents.executeJavaScript(
      'window.lifecycleSmoke.invokeDelayed()',
    );
    await Promise.race([
      started,
      new Promise((_, reject) => setTimeout(
        () => reject(new Error('延迟 IPC 未在 5 秒内开始')),
        5_000,
      )),
    ]);
    window.destroy();
    // Electron may leave executeJavaScript's outer promise pending after its
    // renderer disappears. Attach a rejection sink, but never make shutdown
    // depend on that renderer-owned promise settling.
    void invoke.catch(() => undefined);
    await finished;
    await nextTurn();
    assert(window.isDestroyed(), '延迟 IPC 期间窗口未成功销毁');
  } finally {
    ipcMain.removeHandler(channel);
    if (!window.isDestroyed()) window.destroy();
  }
}

const unhandled = [];
const listenerWarnings = [];
const onUnhandled = (reason) => unhandled.push(reason);
const onWarning = (warning) => {
  if (warning?.name === 'MaxListenersExceededWarning') listenerWarnings.push(warning);
};
process.on('unhandledRejection', onUnhandled);
process.on('warning', onWarning);

app.whenReady()
  .then(async () => {
    // Keep one renderer alive: on Windows Chromium may begin renderer teardown
    // between two rapidly-created windows when the window count briefly hits 0.
    const sentinel = new BrowserWindow({ show: false });
    await sentinel.loadURL('about:blank');
    try {
      await verifyRepeatedWindowLifecycle();
      await verifyDestroyedRendererDuringInvoke();
      await nextTurn();
      assert(unhandled.length === 0, `捕获到 ${unhandled.length} 个未处理 Promise`);
      assert(listenerWarnings.length === 0, '捕获到监听器泄漏告警');
      console.log(JSON.stringify({
        windowCycles: WINDOW_CYCLES,
        kinds: WINDOW_KINDS,
        destroyedRendererDuringInvoke: true,
        unhandledRejections: unhandled.length,
        listenerWarnings: listenerWarnings.length,
        remainingWindows: BrowserWindow.getAllWindows().length - 1,
        remainingWebContents: webContents.getAllWebContents().length - 1,
      }, null, 2));
    } finally {
      if (!sentinel.isDestroyed()) sentinel.destroy();
    }
    app.quit();
  })
  .catch((error) => {
    console.error('[electron-window-lifecycle-smoke] 失败:', error);
    app.exit(1);
  })
  .finally(() => {
    process.removeListener('unhandledRejection', onUnhandled);
    process.removeListener('warning', onWarning);
  });
