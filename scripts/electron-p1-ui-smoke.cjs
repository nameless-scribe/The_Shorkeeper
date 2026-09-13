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
let pending = true;
let documentSynced = false;

function appearance(presetId, colors) {
  return {
    presetId,
    presetName: presetId,
    presets: [],
    colors,
    assets: {
      backgroundUrl: null,
      keeperAvatarUrl: '',
      userAvatarUrl: '',
      builtinBackground: 'keeper-bg.png',
      builtinKeeperAvatar: 'keeper-avatar.png',
      builtinUserAvatar: 'user-avatar.png',
    },
    veil: { chat: `linear-gradient(${colors.navyDeep},${colors.navyDeep})`, status: `linear-gradient(${colors.navyDeep},${colors.navyDeep})` },
    hasCustomAssets: false,
    backgroundFit: 'cover',
    veilOpacity: 0.86,
    showStars: false,
  };
}

const defaultAppearance = appearance('default-smoke', {
  navyDeep: '#07111f', navy: '#0d2036', ice: '#edfaff', iceDeep: '#86cfe6',
  cyan: '#64e8ff', cyanDim: '#348ca0', silver: '#8fa9b7', silverLight: '#cadce5',
});
const violetAppearance = appearance('violet-smoke', {
  navyDeep: '#130d20', navy: '#251538', ice: '#f7efff', iceDeep: '#c9a5e8',
  cyan: '#d09aff', cyanDim: '#875da8', silver: '#aa96b8', silverLight: '#ddcdea',
});

const original = {
  id: 'memory-original', memoryKey: 'user.preference.drink', content: '用户喜欢拿铁',
  importance: 0.9, sourceSessionId: 'session-before', memoryType: 'preference', confidence: 0.92,
  sensitivity: 'normal', modelUsePolicy: 'allow', status: 'disputed', validFrom: now - 86_400_000,
  expiresAt: null, supersededBy: null, createdAt: now - 86_400_000, updatedAt: now,
};
const candidate = {
  id: 'candidate-conflict', memoryKey: 'user.preference.drink', content: '用户现在改喝茶',
  category: 'stable_preference', confidence: 0.98, reason: '用户明确纠正了饮品偏好',
  sourceSessionId: 'session-123456789', sourceMessageId: 'message-1', sourceRunId: 'run-1',
  memoryType: 'preference', sensitivity: 'normal', modelUsePolicy: 'allow', validFrom: now,
  expiresAt: null, conflictsWithMemoryId: original.id, proposedAction: 'replace', status: 'pending',
  createdAt: now, updatedAt: now,
};
let documentInfo = {
  id: 'document-p1', filename: '个人说明.md', filepath: 'knowledge/personal.md', mimeType: 'text/markdown',
  chunkCount: 3, importedAt: now - 3600000, status: 'indexed', statusError: null, updatedAt: now,
  indexedAt: now - 3600000, deletedAt: null, sourcePath: 'C:\\Notes\\个人说明.md', title: '个人说明',
  titleKey: '个人说明', version: 1, supersededBy: null, chunkSize: 800, chunkOverlap: 64,
  sourceKind: 'local_file', sourceModifiedAt: now - 7200000, sourceSize: 1024,
  lastCheckedAt: now - 60000, freshnessStatus: 'changed',
  staleReason: '来源文件已变化，当前仍使用上一次成功索引的快照', syncPolicy: 'manual',
};
const runInfo = {
  id: 'run-p1-source', sessionId: 'session-p1-ui', kind: 'chat', triggerRef: null,
  phase: 'finished', terminalReason: 'completed', errorSummary: null, modelId: 'test-model',
  assistantMessageId: 'assistant-1', stepCount: 0, failedStepCount: 0,
  startedAt: now - 5000, updatedAt: now, terminalAt: now, acknowledgedAt: null,
};

const performance = {
  ragEnabled: true, ragInjectMode: 'catalog', ragMinScore: 0.35, ragMaxChunksPerDoc: 2,
  ragArchiveDedupeThreshold: 0.92, ragNeighborWindow: 1, ragFtsFirst: true,
  ragDocRouteTopK: 3, ragDocRouteMinDocs: 4, ragRerankEnabled: false, ragRerankTopK: 15,
  ragHydeEnabled: false, memoryExtractMode: 'always', memoryExtractInterval: 3,
  maxHistoryMessages: 20, compressThreshold: 30, contextMaxInputTokens: 24000,
  memorySemanticInContext: true, proactivityEnabled: true, quietHoursStart: '', quietHoursEnd: '',
  notificationDedupMinutes: 5,
};

function registerMocks() {
  const voice = {
    ttsEnabled: false, ttsAutoPlay: false, ttsModel: 'cosyvoice-v1', ttsVoiceId: '',
    ttsVoiceSource: 'preset', activeClonedProfileId: null, ttsRate: 1, ttsVolume: 1,
    ttsPlaybackGain: 1, ttsMaxChars: 2000, sttEnabled: false, sttLanguage: 'auto',
    sttModel: 'paraformer-realtime-v2', pushToTalk: false, sttAutoSend: false,
    playbackTarget: 'default', callMode: 'vad_auto', callSilenceMs: 900,
    callAllowBargeIn: true, callPersistTranscript: true, useChatApi: true,
    voiceTtsEndpoint: '', apiKeyConfigured: false, voiceApiKeyMasked: '',
    voiceConfigured: false, ttsEndpoint: '',
  };
  const handlers = {
    'appearance:get': () => defaultAppearance,
    'app:status': () => ({ model: 'test', profileName: 'P1 UI', baseUrl: '', apiConfigured: false, databasePath: 'isolated' }),
    'sessions:current': () => ({ id: 'session-p1-ui', title: 'P1 UI', createdAt: now, updatedAt: now, assistantMode: 'focus' }),
    'messages:list': () => [],
    'model:getProfiles': () => ({ activeId: null, profiles: [] }),
    'voice:getSettings': () => voice,
    'voice:call:isActive': () => ({ active: false }),
    'plugins:get': () => ({ webSearch: false, fetchUrl: true, docGen: true, bookkeeping: true, lifeTools: true, filesystemMode: 'confirm', mcpEnabledCount: 0 }),
    'web-search:getSettings': () => ({ apiKeyMasked: '', apiKeyConfigured: false, provider: 'bocha', source: 'none' }),
    'skills:list': () => [],
    'update:getVersion': () => '1.3.0',
    'performance:get': () => performance,
    'performance:set': (_event, patch) => Object.assign(performance, patch),
    'memory:list': () => [],
    'memory:get': (_event, id) => id === original.id ? original : null,
    'memory:candidates:list': () => pending ? [candidate] : [],
    'memory:candidates:resolve': (_event, id, resolution) => {
      assert(id === candidate.id, '冲突候选 id 不匹配');
      assert(resolution === 'replace', 'UI 未提交 replace 决策');
      pending = false;
      return { ...candidate, status: 'confirmed' };
    },
    'documents:list': () => [documentInfo],
    'documents:embeddingMismatch': () => ({ storedDimensions: [], storedModels: [], storedChunkConfigs: [], hasMismatch: false, modelMismatch: false, dimensionMismatch: false, chunkConfigMismatch: false }),
    'documents:syncSource': () => {
      documentSynced = true;
      documentInfo = { ...documentInfo, id: 'document-p1-v2', version: 2, freshnessStatus: 'current', staleReason: null, lastCheckedAt: Date.now() };
      return documentInfo;
    },
    'documents:checkFreshness': () => documentInfo,
    'documents:setSyncPolicy': (_event, _id, policy) => (documentInfo = { ...documentInfo, syncPolicy: policy }),
    'embedding:getSettings': () => ({ useChatApi: true, baseUrl: '', model: 'test-embedding', apiKeyConfigured: false, apiKeyMasked: '', source: 'chat' }),
    'agent:runHistory': () => [runInfo],
    'agent:runDetail': () => ({
      run: runInfo, steps: [], approvals: [], artifacts: [],
      contextSources: [{
        id: 'context-1', runId: runInfo.id, sourceType: 'document', sourceId: documentInfo.id,
        sourceRef: `doc:${documentInfo.id}#chunk:0`, label: '个人说明.md · 片段 1',
        summary: '相关度 0.91 · 来源状态 changed', documentVersion: 1,
        sourceUpdatedAt: now - 60000, createdAt: now - 5000,
      }],
    }),
    'agent:sourceDetail': (_event, sourceRef) => ({
      sourceType: 'document', sourceId: documentInfo.id, sourceRef, title: '个人说明.md · 片段 1',
      content: '这是本轮回答实际使用的知识片段。', meta: '文档 v1 · changed · 最近检查 1 分钟前', available: true,
    }),
    'permission:respond': () => ({ ok: true }),
  };
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, handler);
}

function registerAssetProtocol() {
  protocol.handle('sk-asset', async (request) => {
    const parsed = new URL(request.url);
    const filename = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
    if (parsed.hostname !== 'dist' || !/^[\w.-]+$/.test(filename)) return new Response('Forbidden', { status: 403 });
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
    format: 'png', captureBeyondViewport: false,
  });
  const parsed = path.parse(filename);
  let target = path.join(directory, filename);
  let attempt = 1;
  while (fs.existsSync(target)) {
    target = path.join(directory, `${parsed.name}_${attempt}${parsed.ext}`);
    attempt += 1;
  }
  fs.writeFileSync(target, Buffer.from(data, 'base64'));
  return target;
}

app.whenReady().then(async () => {
  registerAssetProtocol();
  registerMocks();
  const outputDirectory = process.env.SHOREKEEPER_WALKTHROUGH_DIR
    ? path.resolve(process.env.SHOREKEEPER_WALKTHROUGH_DIR)
    : fs.mkdtempSync(path.join(os.tmpdir(), 'shorekeeper-p1-ui-'));
  fs.mkdirSync(outputDirectory, { recursive: true });
  const window = new BrowserWindow({
    show: true, width: 1200, height: 820,
    webPreferences: {
      preload: path.resolve('dist-electron/preload.mjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  window.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) console.error(`[renderer:${level}] ${message}`);
  });

  try {
    console.log('[electron-p1-ui-smoke] load renderer');
    await window.loadFile(path.resolve('dist/index.html'));
    console.log('[electron-p1-ui-smoke] open settings');
    await waitFor(window, `Boolean(document.querySelector('button[title="设置"]'))`, '设置按钮');
    await window.webContents.executeJavaScript(`document.querySelector('button[title="设置"]').click()`);
    console.log('[electron-p1-ui-smoke] open memory page');
    await waitFor(window, `[...document.querySelectorAll('button')].some((item) => item.textContent.trim().endsWith('记忆'))`, '记忆导航');
    await window.webContents.executeJavaScript(`(() => {
      const item = [...document.querySelectorAll('button')].find((button) => button.textContent.trim().endsWith('记忆'));
      item.click();
    })()`);
    console.log('[electron-p1-ui-smoke] wait for conflict');
    await waitFor(window, `document.body.innerText.includes('发现记忆冲突') && document.body.innerText.includes('原事实') && document.body.innerText.includes('用户现在改喝茶')`, '冲突候选');
    await window.webContents.executeJavaScript(`(() => {
      const node = [...document.querySelectorAll('*')].find((item) => item.textContent.trim() === '发现记忆冲突');
      node.scrollIntoView({ block: 'center' });
    })()`);
    const defaultScreenshot = await capture(window, outputDirectory, 'p1_memory_conflict_default_verified.png');

    console.log('[electron-p1-ui-smoke] switch alternate theme');
    window.webContents.send('appearance:changed', violetAppearance);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const alternateScreenshot = await capture(window, outputDirectory, 'p1_memory_conflict_violet_verified.png');

    console.log('[electron-p1-ui-smoke] verify minimum window');
    window.setSize(360, 520);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await window.webContents.executeJavaScript(`(() => {
      const node = [...document.querySelectorAll('*')].find((item) => item.textContent.trim() === '发现记忆冲突');
      node.scrollIntoView({ block: 'start' });
    })()`);
    const layout = await window.webContents.executeJavaScript(`({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      hasActions: ['保留原事实', '两条并存', '使用新事实'].every((label) => document.body.innerText.includes(label))
    })`);
    assert(layout.documentWidth <= layout.viewport, `最小窗口出现横向溢出: ${layout.documentWidth} > ${layout.viewport}`);
    assert(layout.hasActions, '最小窗口缺少冲突处理动作');
    const minimumScreenshot = await capture(window, outputDirectory, 'p1_memory_conflict_minimum_verified.png');
    window.setSize(1200, 820);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await window.webContents.executeJavaScript(`(() => {
      const node = [...document.querySelectorAll('*')].find((item) => item.textContent.trim() === '发现记忆冲突');
      node.scrollIntoView({ block: 'center' });
    })()`);

    console.log('[electron-p1-ui-smoke] resolve conflict');
    await window.webContents.executeJavaScript(`(() => { window.confirm = () => true; return true; })()`);
    await window.webContents.executeJavaScript(`
      [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === '使用新事实').click()
    `);
    await waitFor(window, `document.body.innerText.includes('暂无待确认候选')`, '冲突处理完成');
    const resolvedScreenshot = await capture(window, outputDirectory, 'p1_memory_conflict_resolved_verified.png');

    console.log('[electron-p1-ui-smoke] verify document freshness and sync');
    await window.webContents.executeJavaScript(`(() => {
      const item = document.querySelector('button[title="泰提斯终端"]');
      item.click();
    })()`);
    await waitFor(window, `document.body.innerText.includes('来源已变化') && document.body.innerText.includes('同步新版本')`, '文档新鲜度状态');
    await window.webContents.executeJavaScript(`(() => {
      const node = [...document.querySelectorAll('*')].find((item) => item.textContent.trim() === '来源已变化');
      node.scrollIntoView({ block: 'center' });
    })()`);
    const freshnessScreenshot = await capture(window, outputDirectory, 'p1_document_freshness_verified.png');
    await window.webContents.executeJavaScript(`
      [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === '同步新版本').click()
    `);
    await waitFor(window, `document.body.innerText.includes('个人说明 · v2') && document.body.innerText.includes('来源一致')`, '文档同步完成');
    assert(documentSynced, '文档同步动作未通过 UI 调用');

    console.log('[electron-p1-ui-smoke] verify run context source detail');
    await window.webContents.executeJavaScript(`(() => {
      const item = document.querySelector('button[title="运行记录"]');
      item.click();
    })()`);
    await waitFor(window, `document.body.innerText.includes('运行列表') && document.body.innerText.includes('test-model')`, '运行记录');
    await window.webContents.executeJavaScript(`(() => {
      const item = [...document.querySelectorAll('button')].find((button) => button.textContent.includes('对话') && button.textContent.includes('已完成'));
      item.click();
    })()`);
    await waitFor(window, `document.body.innerText.includes('使用的上下文') && document.body.innerText.includes('个人说明.md · 片段 1')`, '运行上下文来源');
    await window.webContents.executeJavaScript(`(() => {
      const item = [...document.querySelectorAll('button')].find((button) => button.textContent.includes('个人说明.md · 片段 1'));
      item.click();
    })()`);
    await waitFor(window, `document.body.innerText.includes('这是本轮回答实际使用的知识片段')`, '来源详情');
    const sourceScreenshot = await capture(window, outputDirectory, 'p1_run_context_source_verified.png');

    assert(!pending, '冲突候选未通过 UI 提交 replace 决策');
    console.log(JSON.stringify({
      ok: true,
      rendererDomVerified: true,
      defaultThemeVerified: true,
      alternateThemeVerified: true,
      replaceActionVerified: true,
      minimumWindowVerified: true,
      documentFreshnessVerified: true,
      contextSourceDetailVerified: true,
      screenshots: [defaultScreenshot, alternateScreenshot, minimumScreenshot, resolvedScreenshot, freshnessScreenshot, sourceScreenshot],
    }, null, 2));
  } finally {
    window.destroy();
    app.quit();
  }
}).catch((error) => {
  console.error('[electron-p1-ui-smoke] 失败:', error);
  app.exit(1);
});
