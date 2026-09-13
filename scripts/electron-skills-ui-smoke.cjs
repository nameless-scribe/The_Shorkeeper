const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

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
      builtinBackground: 'assets/background.webp',
      builtinKeeperAvatar: 'assets/keeper.png',
      builtinUserAvatar: 'assets/user.png',
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
  const skills = [{
    id: 'excel',
    name: 'Excel 表格处理',
    description: '读取、分析和安全修改 Excel',
    version: '1.1.0',
    systemPromptFragment: 'smoke',
    allowedTools: ['read_xlsx', 'update_xlsx_cells'],
    requiredTools: ['read_xlsx'],
    trigger: 'auto',
    matchKeywords: ['xlsx', '表格'],
    priority: 10,
    kind: 'capability',
    validationErrors: [],
    enabled: true,
  }];
  const diagnostics = [{
    runId: 'run-ui-smoke',
    sessionId: 'session-ui-smoke',
    modelId: 'test-model',
    activeSkillIds: ['excel'],
    skillDecisions: [{
      skillId: 'excel',
      skillName: 'Excel 表格处理',
      trigger: 'auto',
      status: 'active',
      matchedKeyword: 'xlsx',
      reason: '命中触发词「xlsx」',
    }],
    skillWarnings: [],
    phase: 'finished',
    startedAt: Date.now() - 120,
    terminalAt: Date.now(),
    durationMs: 120,
    terminalReason: 'finished',
    toolCallCount: 2,
    toolFailureCount: 0,
    toolDurationMs: 40,
    promptTokens: 100,
    completionTokens: 20,
    cachedTokens: 0,
    activities: [],
  }];

  const handlers = {
    'appearance:get': () => appearance,
    'app:status': () => ({
      model: 'test-model',
      profileName: 'UI Smoke',
      baseUrl: 'http://127.0.0.1',
      apiConfigured: false,
      databasePath: 'isolated',
    }),
    'sessions:current': () => ({
      id: 'session-ui-smoke',
      title: 'UI Smoke',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      assistantMode: 'focus',
    }),
    'messages:list': () => [],
    'model:getProfiles': () => ({ activeId: null, profiles: [] }),
    'voice:getSettings': () => voice,
    'voice:call:isActive': () => ({ active: false }),
    'plugins:get': () => ({
      webSearch: false,
      fetchUrl: true,
      docGen: true,
      bookkeeping: true,
      lifeTools: true,
      filesystemMode: 'confirm',
      mcpEnabledCount: 0,
    }),
    'web-search:getSettings': () => ({
      apiKeyMasked: '',
      apiKeyConfigured: false,
      provider: 'bocha',
      source: 'none',
    }),
    'skills:list': () => skills,
    'skills:toggle': () => skills,
    'agent:diagnostics': () => diagnostics,
    'update:getVersion': () => '1.3.0',
  };
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, handler);
  }
}

async function waitFor(window, expression, description) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`等待 ${description} 超时`);
}

app.whenReady().then(async () => {
  registerMocks();
  const preloadPath = path.resolve('dist-electron/preload.mjs');
  const indexPath = path.resolve('dist/index.html');
  assert(fs.existsSync(preloadPath), `缺少 preload：${preloadPath}`);
  assert(fs.existsSync(indexPath), `缺少 renderer：${indexPath}`);

  const window = new BrowserWindow({
    show: false,
    width: 1200,
    height: 800,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  try {
    await window.loadFile(indexPath);
    await waitFor(window, `Boolean(document.querySelector('button[title="设置"]'))`, '设置按钮');
    await window.webContents.executeJavaScript(`document.querySelector('button[title="设置"]').click()`);
    await waitFor(window, `document.body.innerText.includes('设置中心')`, '设置抽屉');
    await waitFor(
      window,
      `[...document.querySelectorAll('button')].some((item) => item.textContent.trim().endsWith('技能'))`,
      '技能导航',
    );
    await window.webContents.executeJavaScript(
      `[...document.querySelectorAll('button')].find((item) => item.textContent.trim().endsWith('技能')).click()`,
    );
    await waitFor(
      window,
      `document.body.innerText.includes('最近运行诊断') && document.body.innerText.includes('命中触发词「xlsx」')`,
      'Skill 诊断界面',
    );
    const result = await window.webContents.executeJavaScript(`(() => {
      const text = document.body.innerText;
      return {
        hasSkill: text.includes('Excel 表格处理'),
        hasDiagnostics: text.includes('最近运行诊断'),
        hasRoutingReason: text.includes('命中触发词「xlsx」'),
        hasToolSummary: text.includes('工具 2 次，失败 0 次'),
        containsUserMessage: text.includes('secret-user-message'),
      };
    })()`);
    assert(result.hasSkill, '技能列表未渲染');
    assert(result.hasDiagnostics, '运行诊断区域未渲染');
    assert(result.hasRoutingReason, 'Skill 路由原因未渲染');
    assert(result.hasToolSummary, '工具执行摘要未渲染');
    assert(!result.containsUserMessage, '诊断界面泄露了用户消息正文');
    console.log(JSON.stringify({ ok: true, ...result, rendererDomVerified: true }, null, 2));
  } finally {
    window.destroy();
    app.quit();
  }
}).catch((error) => {
  console.error('[electron-skills-ui-smoke] 失败：', error);
  app.exit(1);
});
