const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function verifySqlJs() {
  const initSqlJs = require('sql.js/dist/sql-wasm.js');
  const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  const database = new SQL.Database();
  try {
    const result = database.exec('SELECT sqlite_version() AS version');
    return String(result[0]?.values[0]?.[0] ?? 'unknown');
  } finally {
    database.close();
  }
}

function verifyNativeCanvas() {
  const { createCanvas } = require('@napi-rs/canvas');
  const canvas = createCanvas(2, 2);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, 2, 2);
  return canvas.toBuffer('image/png').byteLength;
}

async function verifySandboxedPreload() {
  const preloadPath = path.resolve('dist-electron/preload.mjs');
  assert(fs.existsSync(preloadPath), `缺少构建后的 preload: ${preloadPath}`);

  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  try {
    await window.loadURL(
      'data:text/html;charset=utf-8,<meta charset="utf-8"><title>runtime-smoke</title>',
    );
    const capabilities = await window.webContents.executeJavaScript(`({
      bridge: typeof window.shorekeeper === 'object',
      nodeHidden: typeof window.process === 'undefined' && typeof window.require === 'undefined',
      webAssembly: typeof WebAssembly === 'object',
      audioContext: typeof AudioContext === 'function' || typeof webkitAudioContext === 'function'
    })`);
    assert(capabilities.bridge, 'contextBridge 未暴露 shorekeeper API');
    assert(capabilities.nodeHidden, '渲染进程意外暴露 Node.js');
    assert(capabilities.webAssembly, '渲染进程缺少 WebAssembly');
    assert(capabilities.audioContext, '渲染进程缺少 Web Audio API');
    return capabilities;
  } finally {
    window.destroy();
  }
}

app.whenReady()
  .then(async () => {
    const [sqliteVersion, renderer] = await Promise.all([
      verifySqlJs(),
      verifySandboxedPreload(),
    ]);
    console.log(
      JSON.stringify(
        {
          electron: process.versions.electron,
          chrome: process.versions.chrome,
          node: process.versions.node,
          abi: process.versions.modules,
          sqliteVersion,
          nativeCanvasPngBytes: verifyNativeCanvas(),
          renderer,
        },
        null,
        2,
      ),
    );
    app.quit();
  })
  .catch((error) => {
    console.error('[electron-runtime-smoke] 失败:', error);
    app.exit(1);
  });
