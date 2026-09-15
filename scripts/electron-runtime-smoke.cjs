const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, safeStorage, session } = require('electron');

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

// 各项检查各开各关自己的窗口。没有这行，前一项销毁窗口后 Electron 会按默认行为退出，
// 后一项的窗口在退出途中加载失败（ERR_FAILED），而且退出码是 0，冒烟就“假通过”了。
app.on('window-all-closed', () => undefined);

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

function verifySafeStorage() {
  assert(safeStorage.isEncryptionAvailable(), '系统凭据存储不可用');
  const encrypted = safeStorage.encryptString('shorekeeper-runtime-smoke');
  assert(
    safeStorage.decryptString(encrypted) === 'shorekeeper-runtime-smoke',
    '系统凭据存储加解密回环失败',
  );
  return true;
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

/**
 * P5.0：gen_pdf 走隐藏窗口 printToPDF。这里用与 electron/print/markdown-to-pdf.ts 相同的
 * 窗口约束（沙箱、禁 JS、独立 session）打印一份含中文与表格的 HTML，断言产物是 PDF。
 * 中文能否真正落到系统字体只能靠这条冒烟，vitest 里没有 Chromium。
 */
async function verifyPrintToPdf() {
  const html = [
    '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>smoke</title>',
    '<style>body{font-family:"Microsoft YaHei","PingFang SC","Noto Sans CJK SC",sans-serif}',
    'table{border-collapse:collapse}th,td{border:1px solid #888;padding:4px 8px}</style></head>',
    '<body><h1>守岸人 · 打印冒烟</h1><p>中文段落：这份 PDF 由 printToPDF 生成，不再依赖 Helvetica。</p>',
    '<table><thead><tr><th>项目</th><th>金额</th></tr></thead><tbody><tr><td>甲</td><td>12</td></tr></tbody></table>',
    // 故意放一个外链图片：必须被 session 拦下，证明打印窗口不出网
    '<img src="http://127.0.0.1:9/never.png" alt="">',
    '</body></html>',
  ].join('');
  // 与 markdown-to-pdf.ts 一致：只拦 scheme://host 形式的外发请求。
  // 不带过滤器全拦会让 data: 主框架导航以 ERR_FAILED 结束（Electron 44 实测）。
  const printSession = session.fromPartition('shorekeeper-print-smoke');
  const outbound = [];
  printSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    outbound.push(details.url);
    callback({ cancel: true });
  });
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      session: printSession,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: false,
    },
  });
  try {
    await window.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(html, 'utf-8').toString('base64')}`);
    const buffer = await window.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0.59, bottom: 0.59, left: 0.63, right: 0.63 },
    });
    assert(buffer.length > 1000, `printToPDF 产物过小: ${buffer.length} 字节`);
    assert(buffer.subarray(0, 4).toString('latin1') === '%PDF', 'printToPDF 产物不是 PDF');
    assert(
      outbound.length === 1 && outbound[0].startsWith('http://127.0.0.1:9/'),
      `打印窗口的外发请求未被拦截: ${JSON.stringify(outbound)}`,
    );
    return { bytes: buffer.length, blockedRequests: outbound.length };
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
    const printToPdf = await verifyPrintToPdf();
    console.log(
      JSON.stringify(
        {
          electron: process.versions.electron,
          chrome: process.versions.chrome,
          node: process.versions.node,
          abi: process.versions.modules,
          sqliteVersion,
          nativeCanvasPngBytes: verifyNativeCanvas(),
          safeStorage: verifySafeStorage(),
          printToPdf,
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
