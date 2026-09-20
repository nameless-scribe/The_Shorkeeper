const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, ipcMain, net, protocol } = require('electron');

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
const askResponses = [];
let resumeCalls = 0;

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
    phase: 'error',
    terminalReason: 'budget_exhausted',
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
    checkpoint: { id: 'checkpoint-ui', runId, rootRunId: runId, expiresAt: now + 86400000, claimedRunId: null, available: true,
      totals: { rounds: 20, toolCalls: 30, tokens: 300000, activeMs: 5000, segments: 1 } },
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
      apiConfigured: true, databasePath: 'isolated',
    }),
    'sessions:current': () => ({
      id: run.sessionId, title: 'P0 UI Smoke', createdAt: now, updatedAt: now, assistantMode: 'focus',
    }),
    'messages:list': () => [{ id: 'budget-ready', sessionId: run.sessionId, role: 'assistant', content: '预算测试已就绪', createdAt: now }],
    'workspace:getFileInfo': () => null,
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
    'agent:send': async (_event, payload) => {
      assert(payload.resumeCheckpointId === 'checkpoint-ui' && payload.sessionId === run.sessionId && payload.message === '确认继续一段', '继续参数错误');
      resumeCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (resumeCalls === 1) return { ok: false, error: '临时检查失败，请核对后重试' };
      detail.checkpoint.available = false;
      detail.checkpoint.claimedRunId = 'child-ui';
      return { ok: true, runId: 'child-ui' };
    },
    'permission:respond': () => ({ ok: true }),
    'ask:respond': (_event, payload) => { askResponses.push(payload); return { ok: true }; },
    'update:getVersion': () => '1.3.0',
    'proactivity:unreadCount': () => 0,
    'proactivity:inbox': () => ({ attention: [], later: [], handled: [], unreadCount: 0, generatedAt: Date.now() }),
  };
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, handler);
  return appearance;
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
  const appearance = registerMocks();
  const preloadPath = path.resolve('dist-electron/preload.mjs');
  const indexPath = path.resolve('dist/index.html');
  assert(fs.existsSync(preloadPath), `缺少 preload：${preloadPath}`);
  assert(fs.existsSync(indexPath), `缺少 renderer：${indexPath}`);

  const screenshotDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'shorekeeper-p0-ui-'));
  const window = new BrowserWindow({
    show: true,
    // 与真实聊天窗口一致；系统边框的最小宽度会干扰 360px 验收。
    frame: false,
    transparent: false,
    roundedCorners: true,
    backgroundColor: '#0A1128',
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
    const outerFrame = await window.webContents.executeJavaScript(`(() => {
      const shell = document.querySelector('.keeper-panel-shell');
      const background = shell?.querySelector('.pointer-events-none.absolute.inset-0');
      const titlebar = shell?.querySelector('header');
      const read = (node) => {
        if (!node) return null;
        const style = getComputedStyle(node);
        return {
          borderRadius: style.borderRadius,
          borderTopWidth: style.borderTopWidth,
          inset: [style.top, style.right, style.bottom, style.left],
        };
      };
      return { shell: read(shell), background: read(background), titlebar: read(titlebar) };
    })()`);
    assert(outerFrame.shell?.borderRadius === '0px', `主窗口仍叠加 CSS 外圆角: ${JSON.stringify(outerFrame)}`);
    assert(outerFrame.shell?.borderTopWidth === '0px', `主窗口仍有装饰外边框: ${JSON.stringify(outerFrame)}`);
    assert(outerFrame.background?.borderRadius === '0px', `背景仍在四角裁切: ${JSON.stringify(outerFrame)}`);
    assert(outerFrame.titlebar?.borderRadius === '0px', `标题栏仍在四角裁切: ${JSON.stringify(outerFrame)}`);
    // 预算耗尽走现有 error 终态，但必须保留阶段摘要；开发 React 下同时验证订阅不重复。
    setStage('controlled stop keeps partial reply');
    await waitFor(window, `document.body.innerText.includes('预算测试已就绪')`, '会话消息加载完成');
    const stoppedRunId = 'budget-ui-smoke';
    window.webContents.send('agent:event', { type: 'run_started', runId: stoppedRunId, sessionId: 'session-p0-ui-smoke' });
    window.webContents.send('agent:event', { type: 'tool_call_start', runId: stoppedRunId, callId: 'budget-read', name: 'read_file', args: { path: 'report.md' } });
    window.webContents.send('agent:event', { type: 'tool_call_end', runId: stoppedRunId, callId: 'budget-read', result: { success: true, output: '已读取 report.md' } });
    window.webContents.send('agent:event', { type: 'text_delta', runId: stoppedRunId, delta: '阶段摘要保留测试：已读取文件，剩余分析未完成。未保存可精确续跑的检查点。' });
    await waitFor(window, `document.body.innerText.includes('阶段摘要保留测试')`, '流式阶段摘要');
    window.webContents.send('agent:event', { type: 'run_error', runId: stoppedRunId, sessionId: 'session-p0-ui-smoke', reason: 'budget_exhausted', message: '已达到本段工具调用预算' });
    await waitFor(window, `document.body.innerText.includes('已达到本段工具调用预算') && document.body.innerText.includes('阶段摘要保留测试')`, '预算停止后摘要仍在');
    assert(await window.webContents.executeJavaScript(`document.body.innerText.split('阶段摘要保留测试').length === 2`), '阶段摘要重复显示');
    window.setSize(360, 520);
    await waitFor(window, 'window.innerWidth <= 360', '最小聊天尺寸');
    assert(await window.webContents.executeJavaScript('document.querySelector("header").getBoundingClientRect().height < 130'), '最小窗口标题栏挤占摘要区域');
    await window.webContents.executeJavaScript(`document.querySelectorAll('.overflow-y-auto').forEach((element) => { element.scrollTop = element.scrollHeight; })`);
    const budgetDefaultScreenshot = await capture(window, screenshotDirectory, 'budget-stop-default-min.png');
    window.webContents.send('appearance:changed', { ...appearance, colors: {
      ...appearance.colors, navyDeep: '#1b1326', navy: '#2b1d3b', cyan: '#dfa8ed', cyanDim: '#9165a0',
      ice: '#fff2ff', iceDeep: '#ddbbeb',
    } });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const budgetAlternateScreenshot = await capture(window, screenshotDirectory, 'budget-stop-alternate-min.png');
    assert(await window.webContents.executeJavaScript('document.documentElement.scrollWidth <= window.innerWidth'), '预算停止产生横向溢出');
    window.webContents.send('appearance:changed', appearance);
    window.setSize(1200, 820);
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
      `[...document.querySelectorAll('button')].find((item) => item.textContent.includes('对话 · 失败')).click()`,
    );
    await waitFor(
      window,
      `document.body.innerText.includes('工具步骤') && document.body.innerText.includes('审批记录') && document.body.innerText.includes('plan.md')`,
      '运行详情',
    );
    setStage('capture run detail');
    const detailScreenshot = await capture(window, screenshotDirectory, 'run-detail.png');

    setStage('checkpoint confirmation and duplicate submit guard');
    await window.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find((b) => b.textContent === '继续一段').click()`);
    await waitFor(window, `document.body.innerText.includes('确认新增最多 20 次')`, '继续额度确认');
    await window.webContents.executeJavaScript(`[...document.querySelectorAll('h3')].find((h) => h.textContent === '检查点与继续').scrollIntoView({block:'start'})`);
    const checkpointDefaultScreenshot = await capture(window, screenshotDirectory, 'checkpoint-confirm-default.png');
    window.webContents.send('appearance:changed', { ...appearance, colors: { ...appearance.colors, navyDeep: '#1b1326', navy: '#2b1d3b', cyan: '#dfa8ed', cyanDim: '#9165a0' } });
    window.setSize(360, 520);
    await waitFor(window, 'window.innerWidth <= 360', '检查点最小窗口');
    await window.webContents.executeJavaScript(`[...document.querySelectorAll('h3')].find((h) => h.textContent === '检查点与继续').scrollIntoView({block:'start'})`);
    const checkpointMinimumScreenshot = await capture(window, screenshotDirectory, 'checkpoint-confirm-violet-min.png');
    window.setSize(1200, 820);
    window.webContents.send('appearance:changed', appearance);
    await window.webContents.executeJavaScript(`(() => { const b = [...document.querySelectorAll('button')].find((b) => b.textContent === '确认额度并继续'); b.click(); b.click(); })()`);
    await waitFor(window, `[...document.querySelectorAll('button')].some((b) => b.textContent === '继续中…' && b.disabled)`, '继续中禁用');
    await waitFor(window, `document.body.innerText.includes('临时检查失败')`, '继续失败反馈');
    assert(resumeCalls === 1, '重复点击发送了多个继续请求');
    await window.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find((b) => b.textContent === '继续一段').click()`);
    await window.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find((b) => b.textContent === '确认额度并继续').click()`);
    await waitFor(window, `document.body.innerText.includes('检查点已使用')`, '已使用检查点禁用');
    assert(await window.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find((b) => b.textContent === '继续一段').disabled`), '已使用检查点仍可点击');
    assert(resumeCalls === 2, '继续请求计数错误');

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

    // P6.1：ask_user 弹窗——问题、选项、"其他"输入框；点选项即回答，且回答经 ask:respond 送达
    setStage('open question dialog');
    await window.webContents.executeJavaScript(`document.querySelector('[role="dialog"] button[title="拒绝"]').click()`);
    await waitFor(window, `!document.body.innerText.includes('覆盖源工作簿，修改 2 个单元格')`, '关闭 Excel 预览');
    window.webContents.send('ask:request', {
      requestId: 'question-p0-ui-smoke',
      question: '工作区里有两份报价单，改哪一份？',
      why: '税率改动会写回文件，改错文件无法自动撤销',
      options: [
        { id: 'v1', label: '报价单-v1.xlsx', hint: '上周发出的版本' },
        { id: 'v2', label: '报价单-v2.xlsx', hint: '今天修改中的版本' },
      ],
      allowFreeText: true,
    });
    await waitFor(
      window,
      `document.body.innerText.includes('改哪一份？') && document.body.innerText.includes('报价单-v2.xlsx') && document.body.innerText.includes('其他（自己填）') && document.body.innerText.includes('稍后再答')`,
      'ask_user 提问弹窗',
    );
    setStage('capture question dialog');
    const questionScreenshot = await capture(window, screenshotDirectory, 'question-dialog.png');
    await window.webContents.executeJavaScript(`[...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.includes('报价单-v2.xlsx')).click()`);
    await waitFor(window, `!document.body.innerText.includes('改哪一份？')`, '回答后关闭提问弹窗');
    assert(
      askResponses.length === 1 && askResponses[0].requestId === 'question-p0-ui-smoke' && askResponses[0].optionId === 'v2',
      `ask:respond 未收到选项回答: ${JSON.stringify(askResponses)}`,
    );

    assert(
      rendererConsoleErrors.length === 0,
      `渲染进程输出了 ${rendererConsoleErrors.length} 条 console 错误 / 告警：\n${rendererConsoleErrors.join('\n')}`,
    );
    console.log(JSON.stringify({
      ok: true,
      rendererDomVerified: true,
      rendererConsoleClean: true,
      screenshots: [historyScreenshot, detailScreenshot, previewScreenshot, xlsxPreviewScreenshot, questionScreenshot, budgetDefaultScreenshot, budgetAlternateScreenshot, checkpointDefaultScreenshot, checkpointMinimumScreenshot],
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
