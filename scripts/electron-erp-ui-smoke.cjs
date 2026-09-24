const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, ipcMain, net, protocol } = require('electron');

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
const runtimeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'shorekeeper-erp-electron-'));
app.setPath('userData', runtimeDirectory);
app.commandLine.appendSwitch('disk-cache-dir', path.join(runtimeDirectory, 'cache'));
protocol.registerSchemesAsPrivileged([{ scheme: 'sk-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

function assert(condition, message) { if (!condition) throw new Error(message); }
function appearance(presetId, colors) {
  return { presetId, presetName: presetId, presets: [], colors,
    assets: { backgroundUrl: null, keeperAvatarUrl: '', userAvatarUrl: '', builtinBackground: 'keeper-bg.png', builtinKeeperAvatar: 'keeper-avatar.png', builtinUserAvatar: 'user-avatar.png' },
    veil: { chat: `linear-gradient(${colors.navyDeep},${colors.navyDeep})`, status: `linear-gradient(${colors.navyDeep},${colors.navyDeep})` },
    hasCustomAssets: false, backgroundFit: 'cover', veilOpacity: 0.86, showStars: false };
}
const defaultAppearance = appearance('default-smoke', { navyDeep: '#07111f', navy: '#0d2036', ice: '#edfaff', iceDeep: '#86cfe6', cyan: '#64e8ff', cyanDim: '#348ca0', silver: '#8fa9b7', silverLight: '#cadce5' });
const violetAppearance = appearance('violet-smoke', { navyDeep: '#130d20', navy: '#251538', ice: '#f7efff', iceDeep: '#c9a5e8', cyan: '#d09aff', cyanDim: '#875da8', silver: '#aa96b8', silverLight: '#ddcdea' });
const now = Date.now();
const voice = { ttsEnabled: false, ttsAutoPlay: false, ttsModel: 'cosyvoice-v1', ttsVoiceId: '', ttsVoiceSource: 'preset', activeClonedProfileId: null, ttsRate: 1, ttsVolume: 1, ttsPlaybackGain: 1, ttsMaxChars: 2000, sttEnabled: false, sttLanguage: 'auto', sttModel: 'paraformer-realtime-v2', pushToTalk: false, sttAutoSend: false, playbackTarget: 'default', callMode: 'vad_auto', callSilenceMs: 900, callAllowBargeIn: true, callPersistTranscript: true, useChatApi: true, voiceTtsEndpoint: '', apiKeyConfigured: false, voiceApiKeyMasked: '', voiceConfigured: false, ttsEndpoint: '' };
const erpSettings = { enabled: true, origin: 'http://49.7.10.65:9024', apiPrefix: '/prod-api', browserChannel: 'msedge', username: 'demo.user', passwordConfigured: true, configured: true, reason: null };
const erpConnection = { state: 'browser_open', origin: erpSettings.origin, browserChannel: 'msedge', pageUrl: `${erpSettings.origin}/login`, userId: null, userName: null, message: '账号密码已代填；请核对验证码并登录，然后点击“检测登录”' };

function registerMocks() {
  const handlers = {
    'appearance:get': () => defaultAppearance,
    'app:status': () => ({ model: 'test', profileName: 'ERP UI', baseUrl: '', apiConfigured: false, databasePath: 'isolated' }),
    'sessions:current': () => ({ id: 'session-erp-ui', title: 'ERP UI', createdAt: now, updatedAt: now, assistantMode: 'focus' }),
    'messages:list': () => [], 'model:getProfiles': () => ({ activeId: null, profiles: [] }),
    'voice:getSettings': () => voice, 'voice:call:isActive': () => ({ active: false }),
    'plugins:get': () => ({ webSearch: false, fetchUrl: true, docGen: true, bookkeeping: true, lifeTools: true, filesystemMode: 'confirm', mcpEnabledCount: 0 }),
    'web-search:getSettings': () => ({ apiKeyMasked: '', apiKeyConfigured: false, provider: 'bocha', source: 'none' }),
    'skills:list': () => [], 'transcripts:list': () => [], 'update:getVersion': () => '1.3.0',
    'performance:get': () => ({ ragEnabled: true, ragInjectMode: 'catalog', ragMinScore: 0.35, ragMaxChunksPerDoc: 2, ragArchiveDedupeThreshold: 0.92, ragNeighborWindow: 1, ragFtsFirst: true, ragDocRouteTopK: 3, ragDocRouteMinDocs: 4, ragRerankEnabled: false, ragRerankTopK: 15, ragHydeEnabled: false, memoryExtractMode: 'always', memoryExtractInterval: 3, maxHistoryMessages: 20, compressThreshold: 30, contextMaxInputTokens: 24000, memorySemanticInContext: true, proactivityEnabled: false, quietHoursStart: '', quietHoursEnd: '', notificationDedupMinutes: 5, notifyHourlyLimit: 3, notifyDailyLimit: 12, mutedEventDomains: [], keepInboxHistoryWhenDisabled: true }),
    'proactivity:unreadCount': () => 0, 'proactivity:inbox': () => ({ attention: [], later: [], handled: [], unreadCount: 0, generatedAt: now }),
    'memory:list': () => [], 'memory:candidates:list': () => [], 'permission:respond': () => ({ ok: true }),
    'erp:getSettings': () => erpSettings, 'erp:status': () => erpConnection,
    'erp:saveSettings': () => erpSettings, 'erp:connect': () => erpConnection, 'erp:refresh': () => erpConnection,
    'erp:bringToFront': () => erpConnection, 'erp:disconnect': () => ({ ...erpConnection, state: 'disconnected', message: 'ERP 浏览器未连接' }),
  };
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, handler);
}

function registerAssetProtocol() {
  protocol.handle('sk-asset', async (request) => {
    const parsed = new URL(request.url); const filename = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
    if (parsed.hostname !== 'dist' || !/^[\w.-]+$/.test(filename)) return new Response('Forbidden', { status: 403 });
    const target = path.resolve('dist', filename); if (!fs.existsSync(target)) return new Response('Not Found', { status: 404 });
    return net.fetch(pathToFileURL(target).href);
  });
}
async function waitFor(win, expression, description) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) { if (await win.webContents.executeJavaScript(expression)) return; await new Promise((resolve) => setTimeout(resolve, 50)); }
  throw new Error(`等待 ${description} 超时`);
}
async function capture(win, directory, filename) {
  if (!win.webContents.debugger.isAttached()) win.webContents.debugger.attach('1.3');
  const { data } = await win.webContents.debugger.sendCommand('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const target = path.join(directory, filename); fs.writeFileSync(target, Buffer.from(data, 'base64')); return target;
}

app.whenReady().then(async () => {
  registerAssetProtocol(); registerMocks();
  const outputDirectory = process.env.SHOREKEEPER_WALKTHROUGH_DIR ? path.resolve(process.env.SHOREKEEPER_WALKTHROUGH_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'shorekeeper-erp-ui-'));
  fs.mkdirSync(outputDirectory, { recursive: true });
  const win = new BrowserWindow({ show: true, width: 1200, height: 820, webPreferences: { preload: path.resolve('dist-electron/preload.mjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  const rendererErrors = [];
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 2) rendererErrors.push(`[${level}] ${message}`); });
  let exitCode = 0;
  try {
    if (process.env.SHOREKEEPER_SMOKE_FORCE_FAILURE === '1') throw new Error('ERP UI smoke intentional failure');
    await win.loadFile(path.resolve('dist/index.html'));
    await waitFor(win, `Boolean(document.querySelector('button[title="设置"]'))`, '设置按钮');
    await win.webContents.executeJavaScript(`document.querySelector('button[title="设置"]').click()`);
    await waitFor(win, `[...document.querySelectorAll('button')].some((item) => item.textContent.trim().endsWith('ERP 报工'))`, 'ERP 设置导航');
    await win.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find((item) => item.textContent.trim().endsWith('ERP 报工')).click()`);
    await waitFor(win, `document.body.innerText.includes('专用浏览器') && document.body.innerText.includes('Microsoft Edge')`, 'ERP 设置页');
    const defaultShot = await capture(win, outputDirectory, 'erp_settings_default_verified.png');
    win.webContents.send('appearance:changed', violetAppearance); await new Promise((resolve) => setTimeout(resolve, 250));
    const violetShot = await capture(win, outputDirectory, 'erp_settings_violet_verified.png');
    win.setSize(360, 520); await new Promise((resolve) => setTimeout(resolve, 300));
    const layout = await win.webContents.executeJavaScript(`({ viewport: window.innerWidth, documentWidth: document.documentElement.scrollWidth, hasConnection: document.body.innerText.includes('检测登录') })`);
    assert(layout.documentWidth <= layout.viewport, `最小窗口出现横向溢出: ${layout.documentWidth} > ${layout.viewport}`);
    assert(layout.hasConnection, '最小窗口缺少连接操作');
    const minimumShot = await capture(win, outputDirectory, 'erp_settings_minimum_verified.png');
    win.setSize(760, 720); win.webContents.send('appearance:changed', defaultAppearance);
    win.webContents.send('permission:request', {
      requestId: 'erp-preview-smoke', toolName: 'submit_erp_report', args: { draft_id: 'draft-smoke', draft_revision: 2 }, risk: 'high',
      preview: {
        kind: 'erp-work-report', target: '草稿 draft-smoke · revision 2', summary: '将向 ERP 新增 2 条报工，共 5.5 小时', revision: 'preview-smoke',
        erpWorkReport: { accountName: '苏运来（7）', workDate: '2026-09-21', existingMinutes: 60, batchMinutes: 330, totalMinutes: 390, remainingMinutes: 90,
          items: [
            { itemId: 'aps', projectName: '光拓智能日常', taskName: 'APS 自动排产系统调整', workMinutes: 210, workContent: '调整排产算法，修复扫描问题。' },
            { itemId: 'purchase', projectName: '新希望订单系统', taskName: '采购列表筛选优化', workMinutes: 120, workContent: '修改采购列表筛选功能。' },
          ] },
      },
    });
    await waitFor(win, `document.body.innerText.includes('将向 ERP 新增 2 条报工') && document.body.innerText.includes('确认并执行')`, 'ERP 报工确认预览');
    const previewDefaultShot = await capture(win, outputDirectory, 'erp_permission_default_verified.png');
    win.webContents.send('appearance:changed', violetAppearance); await new Promise((resolve) => setTimeout(resolve, 250));
    const previewVioletShot = await capture(win, outputDirectory, 'erp_permission_violet_verified.png');
    win.setSize(360, 520); await new Promise((resolve) => setTimeout(resolve, 250));
    const previewLayout = await win.webContents.executeJavaScript(`({ viewport: window.innerWidth, documentWidth: document.documentElement.scrollWidth, hasConfirm: document.body.innerText.includes('确认并执行') })`);
    assert(previewLayout.documentWidth <= previewLayout.viewport, `ERP 预览最小窗口出现横向溢出: ${previewLayout.documentWidth} > ${previewLayout.viewport}`);
    assert(previewLayout.hasConfirm, 'ERP 预览最小窗口缺少确认操作');
    const previewMinimumShot = await capture(win, outputDirectory, 'erp_permission_minimum_verified.png');
    await win.webContents.executeJavaScript(`[...document.querySelectorAll('[role="dialog"] button')].find((item) => item.textContent.trim() === '拒绝').click()`);
    await waitFor(win, `!document.querySelector('[role="dialog"]')`, '关闭首轮报工预览');
    win.setSize(760, 720); win.webContents.send('appearance:changed', defaultAppearance);
    win.webContents.send('permission:request', {
      requestId: 'erp-resume-preview-smoke', toolName: 'submit_erp_report', args: { batch_id: 'batch-smoke' }, risk: 'high',
      preview: {
        kind: 'erp-work-report', target: '批次 batch-smoke · 剩余条目',
        summary: '已核验 1 条；本次将新增剩余 1 条，共 2 小时', revision: 'resume-preview-smoke',
        erpWorkReport: { accountName: '苏运来（7）', workDate: '2026-09-21', existingMinutes: 270,
          batchMinutes: 120, totalMinutes: 390, remainingMinutes: 90,
          items: [{ itemId: 'purchase', projectName: '新希望订单系统', taskName: '采购列表筛选优化',
            workMinutes: 120, workContent: '修改采购列表筛选功能。' }] },
      },
    });
    await waitFor(win, `document.body.innerText.includes('已核验 1 条；本次将新增剩余 1 条')`, 'ERP 剩余条目接续预览');
    const resumeShot = await capture(win, outputDirectory, 'erp_permission_resume_verified.png');
    assert(rendererErrors.length === 0, `renderer console errors: ${rendererErrors.join(' | ')}`);
    console.log(JSON.stringify({ ok: true, screenshots: [defaultShot, violetShot, minimumShot, previewDefaultShot, previewVioletShot, previewMinimumShot, resumeShot] }));
  } catch (error) { console.error(error); exitCode = 1; }
  finally { if (!win.isDestroyed()) win.destroy(); app.exit(exitCode); }
}).catch((error) => { console.error(error); app.exit(1); });
