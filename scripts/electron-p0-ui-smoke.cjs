const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, ipcMain, net, protocol } = require('electron');

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

protocol.registerSchemesAsPrivileged([{
  scheme: 'sk-asset',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const now = Date.now();
const runId = 'run-p0-ui-smoke';

function registerMocks() {
  const appearance = {
    presetId: 'smoke',
    presetName: 'Smoke',
    presets: [],
    colors: {
      navyDeep: '#07111f',
      navy: '#0d2036',
      ice: '#edfaff',
      iceDeep: '#86cfe6',
      cyan: '#64e8ff',
      cyanDim: '#348ca0',
      silver: '#8fa9b7',
      silverLight: '#cadce5',
    },
    assets: {
      backgroundUrl: null,
      keeperAvatarUrl: '',
      userAvatarUrl: '',
      builtinBackground: 'keeper-bg.png',
      builtinKeeperAvatar: 'keeper-avatar.png',
      builtinUserAvatar: 'user-avatar.png',
    },
    veil: { chat: 'linear-gradient(#07111f,#07111f)', status: 'linear-gradient(#07111f,#07111f)' },
    hasCustomAssets: false,
    backgroundFit: 'cover',
    veilOpacity: 0.8,
    showStars: false,
  };
  const voice = {
    ttsEnabled: false,
    ttsAutoPlay: false,
    ttsModel: 'cosyvoice-v1',
    ttsVoiceId: '',
    ttsVoiceSource: 'preset',
    activeClonedProfileId: null,
    ttsRate: 1,
    ttsVolume: 1,
    ttsPlaybackGain: 1,
    ttsMaxChars: 2000,
    sttEnabled: false,
    sttLanguage: 'auto',
    sttModel: 'paraformer-realtime-v2',
    pushToTalk: false,
    sttAutoSend: false,
    playbackTarget: 'default',
    callMode: 'vad_auto',
    callSilenceMs: 900,
    callAllowBargeIn: true,
    callPersistTranscript: true,
    useChatApi: true,
    voiceTtsEndpoint: '',
    apiKeyConfigured: false,
    voiceApiKeyMasked: '',
    voiceConfigured: false,
    ttsEndpoint: '',
  };
  const run = {
    id: runId,
    sessionId: 'session-p0-ui-smoke',
    kind: 'chat',
    triggerRef: null,
    phase: 'finished',
    terminalReason: 'finished',
    errorSummary: null,
    modelId: 'qwen-plus',
    assistantMessageId: 'message-p0-ui-smoke',
    stepCount: 2,
    failedStepCount: 0,
    startedAt: now - 4_200,
    updatedAt: now,
    terminalAt: now,
    acknowledgedAt: null,
  };
  const detail = {
  contextSources: [],
    run,
    steps: [
      {
        id: 'step-preview', runId, callId: 'call-preview', seq: 1,
        toolName: 'replace_text', status: 'succeeded', errorCategory: null,
        errorSummary: null, riskLevel: 'medium', idempotent: false,
        startedAt: now - 4_000, endedAt: now - 3_200,
      },
      {
        id: 'step-verify', runId, callId: 'call-verify', seq: 2,
        toolName: 'read_file', status: 'succeeded', errorCategory: null,
        errorSummary: null, riskLevel: 'read', idempotent: true,
        startedAt: now - 3_000, endedAt: now - 2_500,
      },
    ],
    approvals: [{
      id: 'approval-p0-ui-smoke', runId, sessionId: run.sessionId,
      toolName: 'replace_text', argsSummary: '{"path":"docs/plan.md"}',
      riskLevel: 'medium', status: 'approved', decidedBy: 'user',
      requestedAt: now - 3_900, decidedAt: now - 3_300,
    }],
    artifacts: [{
      id: 'artifact-p0-ui-smoke', runId, stepId: 'step-preview', sessionId: run.sessionId,
      toolName: 'replace_text', relativePath: 'docs/plan.md', originalName: 'plan.md',
      size: 1024, sha256: 'a'.repeat(64), createdAt: now - 3_100,
    }],
  };

  const handlers = {
    'appearance:get': () => appearance,
    'app:status': () => ({
      model: 'qwen-plus', profileName: 'P0 UI Smoke', baseUrl: 'http://127.0.0.1',
      apiConfigured: false, databasePath: 'isolated',
    }),
    'sessions:current': () => ({
      id: run.sessionId, title: 'P0 UI Smoke', createdAt: now, updatedAt: now, assistantMode: 'focus',
    }),
    'messages:list': () => [],
    'model:getProfiles': () => ({ activeId: null, profiles: [] }),
    'voice:getSettings': () => voice,
    'voice:call:isActive': () => ({ active: false }),
    'plugins:get': () => ({
      webSearch: false, fetchUrl: true, docGen: true, bookkeeping: true,
      lifeTools: true, filesystemMode: 'confirm', mcpEnabledCount: 0,
    }),
    'web-search:getSettings': () => ({
      apiKeyMasked: '', apiKeyConfigured: false, provider: 'bocha', source: 'none',
    }),
    'skills:list': () => [],
    'agent:runHistory': () => [run],
    'transcripts:list': () => [],
    'agent:runDetail': (_event, requestedRunId) => requestedRunId === runId ? detail : null,
    'permission:respond': () => ({ ok: true }),
    'update:getVersion': () => '1.3.0',
    'proactivity:unreadCount': () => 0,
    'proactivity:inbox': () => ({ attention: [], later: [], handled: [], unreadCount: 0, generatedAt: Date.now() }),
  };
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, handler);
}

function registerAssetProtocol() {
  protocol.handle('sk-asset', async (request) => {
    const parsed = new URL(request.url);
    const filename = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
    if (parsed.hostname !== 'dist' || !/^[\w.-]+$/.test(filename)) {
      return new Response('Forbidden', { status: 403 });
    }
    const target = path.resolve('dist', filename);
    if (!fs.existsSync(target)) return new Response('Not Found', { status: 404 });
    return net.fetch(pathToFileURL(target).href);
  });
}

async function waitFor(window, expression, description) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`等待 ${description} 超时`);
}

async function capture(window, directory, filename) {
  if (!window.webContents.debugger.isAttached()) window.webContents.debugger.attach('1.3');
  const { data } = await window.webContents.debugger.sendCommand('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  const target = path.join(directory, filename);
  fs.writeFileSync(target, Buffer.from(data, 'base64'));
  return target;
}

app.whenReady().then(async () => {
  registerAssetProtocol();
  registerMocks();
  const preloadPath = path.resolve('dist-electron/preload.mjs');
  const indexPath = path.resolve('dist/index.html');
  assert(fs.existsSync(preloadPath), `缺少 preload：${preloadPath}`);
  assert(fs.existsSync(indexPath), `缺少 renderer：${indexPath}`);

  const screenshotDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'shorekeeper-p0-ui-'));
  const window = new BrowserWindow({
    show: true,
    width: 1200,
    height: 820,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // 见 electron-p3-ui-smoke.cjs：开发版 React 下的违规只体现为 console 告警，只打印等于放过。
  const rendererConsoleErrors = [];
  window.webContents.on('console-message', (_event, level, message) => {
    if (level < 2) return;
    console.error(`[renderer:${level}] ${message}`);
    rendererConsoleErrors.push(`[${level}] ${message}`);
  });

  try {
    let stage = 'load renderer';
    const setStage = (value) => {
      stage = value;
      console.log(`[electron-p0-ui-smoke] ${stage}`);
    };
    setStage('load renderer');
    await window.loadFile(indexPath);
    setStage('open settings');
    await waitFor(window, `Boolean(document.querySelector('button[title="设置"]'))`, '设置按钮');
    await window.webContents.executeJavaScript(`document.querySelector('button[title="设置"]').click()`);
    setStage('open run history');
    await waitFor(
      window,
      `[...document.querySelectorAll('button')].some((item) => item.textContent.trim().endsWith('运行记录'))`,
      '运行记录导航',
    );
    await window.webContents.executeJavaScript(
      `(() => { const item = [...document.querySelectorAll('button')].find((button) => button.textContent.trim().endsWith('运行记录')); item.scrollIntoView({ block: 'center' }); item.click(); })()`,
    );
    await waitFor(window, `document.body.innerText.includes('最近 1 条')`, '运行记录列表');
    setStage('capture run history');
    const historyScreenshot = await capture(window, screenshotDirectory, 'run-history.png');

    setStage('open run detail');
    await window.webContents.executeJavaScript(
      `[...document.querySelectorAll('button')].find((item) => item.textContent.includes('对话 · 已完成')).click()`,
    );
    await waitFor(
      window,
      `document.body.innerText.includes('工具步骤') && document.body.innerText.includes('审批记录') && document.body.innerText.includes('plan.md')`,
      '运行详情',
    );
    setStage('capture run detail');
    const detailScreenshot = await capture(window, screenshotDirectory, 'run-detail.png');

    setStage('open write preview');
    await window.webContents.executeJavaScript(`document.querySelector('button[title="关闭"]').click()`);
    window.webContents.send('permission:request', {
      requestId: 'permission-p0-ui-smoke',
      toolName: 'replace_text',
      args: { path: 'docs/plan.md', old_text: '旧内容', new_text: '新内容' },
      risk: 'medium',
      preview: {
        kind: 'text-diff', target: 'docs/plan.md', summary: '精确替换 1 处；原文件在确认前不会修改',
        revision: `sha256:${'b'.repeat(64)}:12`, details: ['匹配次数：1', '替换后大小：12 字节'],
        before: '# 计划\n\n旧内容', after: '# 计划\n\n新内容',
      },
    });
    await waitFor(
      window,
      `document.body.innerText.includes('确认并执行：精确替换文本？') && document.body.innerText.includes('修改前') && document.body.innerText.includes('修改后')`,
      '写操作预览弹窗',
    );
    setStage('capture write preview');
    const previewScreenshot = await capture(window, screenshotDirectory, 'write-preview.png');

    const result = await window.webContents.executeJavaScript(`(() => {
      const text = document.body.innerText;
      return {
        hasPreviewSafetyNote: text.includes('当前仅为预览，尚未写入'),
        hasConfirmButton: text.includes('确认并执行'),
        hasBeforeAfter: text.includes('修改前') && text.includes('修改后'),
      };
    })()`);
    assert(result.hasPreviewSafetyNote, '预览弹窗缺少无副作用说明');
    assert(result.hasConfirmButton, '预览弹窗缺少确认执行按钮');
    assert(result.hasBeforeAfter, '预览弹窗缺少修改前后内容');

    setStage('open Excel preview');
    await window.webContents.executeJavaScript(`document.querySelector('[role="dialog"] button[title="拒绝"]').click()`);
    await waitFor(window, `!document.body.innerText.includes('精确替换 1 处；原文件在确认前不会修改')`, '关闭文本预览');
    window.webContents.send('permission:request', {
      requestId: 'permission-xlsx-p0-ui-smoke',
      toolName: 'update_xlsx_cells',
      args: { source_path: 'data/tasks.xlsx', updates: [{ cell: 'A1', value: '新标题' }] },
      risk: 'medium',
      preview: {
        kind: 'cell-changes', target: 'data/tasks.xlsx', summary: '覆盖源工作簿，修改 2 个单元格',
        revision: JSON.stringify({ source: `sha256:${'c'.repeat(64)}:2048`, output: 'same' }),
        details: ['来源：data/tasks.xlsx', '工作表：任务'],
        changes: [
          { label: 'A1', before: '旧标题', after: '新标题' },
          { label: 'B2', before: '待处理', after: '已完成' },
        ],
      },
    });
    await waitFor(
      window,
      `document.body.innerText.includes('确认并执行：修改 Excel 单元格？') && document.body.innerText.includes('单元格') && document.body.innerText.includes('旧标题') && document.body.innerText.includes('新标题')`,
      'Excel 单元格预览弹窗',
    );
    setStage('capture Excel preview');
    const xlsxPreviewScreenshot = await capture(window, screenshotDirectory, 'xlsx-preview.png');

    assert(
      rendererConsoleErrors.length === 0,
      `渲染进程输出了 ${rendererConsoleErrors.length} 条 console 错误 / 告警：\n${rendererConsoleErrors.join('\n')}`,
    );
    console.log(JSON.stringify({
      ok: true,
      rendererDomVerified: true,
      rendererConsoleClean: true,
      screenshots: [historyScreenshot, detailScreenshot, previewScreenshot, xlsxPreviewScreenshot],
      ...result,
    }, null, 2));
  } catch (error) {
    throw error;
  } finally {
    window.destroy();
    app.quit();
  }
}).catch((error) => {
  console.error('[electron-p0-ui-smoke] 失败：', error);
  app.exit(1);
});
