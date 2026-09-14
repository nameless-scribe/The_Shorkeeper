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
const HOUR = 60 * 60 * 1000;

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

function event(overrides) {
  return {
    id: 'event-1', domain: 'commitment', kind: 'commitment_due_soon', sourceType: 'commitment', sourceId: 'commitment-1',
    sourceRef: null, dedupeKey: 'commitment:commitment-1:due_soon:today', sourceVersion: 0,
    title: '承诺临期：回复客户报价', summary: '将于今天 15:00 到期（答应了 客户）。完成后请在待办或承诺中标记。',
    urgency: 'high', status: 'open', dueAt: now + HOUR, occurredAt: now - 2 * HOUR, expiresAt: null,
    snoozedUntil: null, resolvedAt: null, resolvedReason: null, readAt: null, createdAt: now - 2 * HOUR, updatedAt: now - 2 * HOUR,
    ...overrides,
  };
}

const events = {
  commitment: event({}),
  run: event({
    id: 'event-2', domain: 'run', kind: 'run_error', sourceType: 'task_run', sourceId: 'run-1', sourceRef: 'session:s1',
    dedupeKey: 'run:run-1:error', title: '对话运行失败', summary: '原因：模型超时。工具步骤 2/3 成功。打开可查看真实步骤与产物；不会自动重跑。',
    urgency: 'normal', dueAt: null, occurredAt: now - 30 * 60 * 1000,
  }),
  document: event({
    id: 'event-3', domain: 'document', kind: 'document_changed', sourceType: 'document', sourceId: 'doc-1',
    dedupeKey: 'doc:doc-1:changed:2', sourceVersion: 2, title: '本地文件已变化：个人说明',
    summary: '知识库里的内容比本地文件旧。打开泰提斯终端可同步新版本或保留当前快照。',
    urgency: 'low', dueAt: null, occurredAt: now - 5 * HOUR, readAt: now - HOUR,
  }),
};

const items = {
  attention: [
    { event: events.commitment, lastRoute: 'notify', lastRouteReason: 'notified', deliveredAt: now - HOUR, deferredUntil: null },
    { event: events.run, lastRoute: 'inbox', lastRouteReason: 'inbox_default', deliveredAt: null, deferredUntil: null },
    { event: events.document, lastRoute: 'inbox', lastRouteReason: 'low_urgency', deliveredAt: null, deferredUntil: null },
  ],
  later: [],
  handled: [],
};

const actions = { markRead: [], openSource: [], dismissed: [], snoozed: [], resolved: [], refreshed: 0, cleared: 0 };

function snapshot() {
  return {
    attention: items.attention,
    later: items.later,
    handled: items.handled,
    unreadCount: items.attention.filter((item) => item.event.readAt == null).length,
    generatedAt: Date.now(),
  };
}

function findItem(id) {
  for (const section of ['attention', 'later', 'handled']) {
    const index = items[section].findIndex((item) => item.event.id === id);
    if (index >= 0) return { section, index, item: items[section][index] };
  }
  return null;
}

function moveItem(id, target, patch) {
  const found = findItem(id);
  assert(found, `未知事件 ${id}`);
  items[found.section].splice(found.index, 1);
  const next = { ...found.item, event: { ...found.item.event, ...patch, updatedAt: Date.now() } };
  items[target].unshift(next);
  return next.event;
}

const performance = {
  ragEnabled: true, ragInjectMode: 'catalog', ragMinScore: 0.35, ragMaxChunksPerDoc: 2,
  ragArchiveDedupeThreshold: 0.92, ragNeighborWindow: 1, ragFtsFirst: true,
  ragDocRouteTopK: 3, ragDocRouteMinDocs: 4, ragRerankEnabled: false, ragRerankTopK: 15,
  ragHydeEnabled: false, memoryExtractMode: 'always', memoryExtractInterval: 3,
  maxHistoryMessages: 20, compressThreshold: 30, contextMaxInputTokens: 24000,
  memorySemanticInContext: true, proactivityEnabled: true, quietHoursStart: '', quietHoursEnd: '',
  notificationDedupMinutes: 5, notifyHourlyLimit: 3, notifyDailyLimit: 12, mutedEventDomains: [],
  keepInboxHistoryWhenDisabled: true,
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
    'app:status': () => ({ model: 'test', profileName: 'P3 UI', baseUrl: '', apiConfigured: false, databasePath: 'isolated' }),
    'sessions:current': () => ({ id: 'session-p3-ui', title: 'P3 UI', createdAt: now, updatedAt: now, assistantMode: 'focus' }),
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
    'memory:candidates:list': () => [],
    'userTasks:list': () => [],
    'agent:runHistory': () => [],
    'permission:respond': () => ({ ok: true }),
    'proactivity:inbox': () => snapshot(),
    'proactivity:unreadCount': () => snapshot().unreadCount,
    'proactivity:markRead': (_event, id) => {
      actions.markRead.push(id);
      const found = findItem(id);
      assert(found, `markRead 未知事件 ${id}`);
      found.item.event.readAt = Date.now();
      return found.item.event;
    },
    'proactivity:markAllRead': () => 0,
    'proactivity:openSource': (_event, id) => {
      actions.openSource.push(id);
      const found = findItem(id);
      assert(found, `openSource 未知事件 ${id}`);
      found.item.event.readAt = Date.now();
      const open = found.item.event.domain === 'run' ? 'runs' : found.item.event.domain === 'document' ? 'documents' : 'userTodos';
      return { domain: found.item.event.domain, sourceType: found.item.event.sourceType, sourceId: found.item.event.sourceId, sourceRef: null, open, suggestedPrompt: null };
    },
    'proactivity:dismiss': (_event, id, reason) => {
      assert(reason === 'not_relevant', 'UI 未提交有限枚举的忽略原因');
      actions.dismissed.push(id);
      return moveItem(id, 'handled', { status: 'dismissed', resolvedAt: Date.now(), resolvedReason: reason });
    },
    'proactivity:snooze': (_event, id, minutes) => {
      assert([30, 120, 1440, 4320].includes(minutes), `UI 提交了非预设的稍后时长 ${minutes}`);
      actions.snoozed.push([id, minutes]);
      return moveItem(id, 'later', { status: 'snoozed', snoozedUntil: Date.now() + minutes * 60_000 });
    },
    'proactivity:resolve': (_event, id) => {
      actions.resolved.push(id);
      return moveItem(id, 'handled', { status: 'resolved', resolvedAt: Date.now(), resolvedReason: 'user:already_handled' });
    },
    'proactivity:clearHandled': () => {
      actions.cleared += items.handled.length;
      const removed = items.handled.length;
      items.handled = [];
      return removed;
    },
    'proactivity:refresh': () => {
      actions.refreshed += 1;
      return snapshot();
    },
    'proactivity:metrics': () => ({}),
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
  const text = await window.webContents.executeJavaScript('document.body.innerText.slice(0, 1200)').catch(() => '');
  throw new Error(`等待 ${description} 超时
--- 页面文本 ---
${text}`);
}

async function capture(window, directory, filename) {
  if (!window.webContents.debugger.isAttached()) window.webContents.debugger.attach('1.3');
  const { data } = await window.webContents.debugger.sendCommand('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: false,
  });
  const target = path.join(directory, filename);
  fs.writeFileSync(target, Buffer.from(data, 'base64'));
  return target;
}

const clickButton = (label) => `(() => {
  const button = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === ${JSON.stringify(label)});
  if (!button) return false;
  button.click();
  return true;
})()`;

/** 收件箱卡片：标题在按钮内的第一个 <p> 里，按钮文本还包含副标题。 */
const clickCard = (title) => `(() => {
  const button = [...document.querySelectorAll('[data-testid="inbox-item"] button[aria-expanded]')]
    .find((item) => item.querySelector('p')?.textContent.trim() === ${JSON.stringify(title)});
  if (!button) return false;
  button.click();
  return true;
})()`;

/** 卡片内的动作按钮：限定在收件箱条目里，避免误点同名分区页签。 */
const clickCardAction = (label) => `(() => {
  const button = [...document.querySelectorAll('[data-testid="inbox-item"] button')]
    .find((item) => item.getAttribute('role') !== 'tab' && item.textContent.trim() === ${JSON.stringify(label)});
  if (!button) return false;
  button.click();
  return true;
})()`;

const closeSettings = `(() => {
  const buttons = [...document.querySelectorAll('button[title="关闭"]')];
  const drawerClose = buttons.find((button) => button.closest('.absolute.inset-0'));
  if (!drawerClose) return false;
  drawerClose.click();
  return true;
})()`;

app.whenReady().then(async () => {
  registerAssetProtocol();
  registerMocks();
  const outputDirectory = process.env.SHOREKEEPER_WALKTHROUGH_DIR
    ? path.resolve(process.env.SHOREKEEPER_WALKTHROUGH_DIR)
    : fs.mkdtempSync(path.join(os.tmpdir(), 'shorekeeper-p3-ui-'));
  fs.mkdirSync(outputDirectory, { recursive: true });
  const window = new BrowserWindow({
    show: true, width: 1200, height: 820,
    webPreferences: {
      preload: path.resolve('dist-electron/preload.mjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  // 收尾统一断言：开发版 React（pnpm test:ui:strict）下的 StrictMode 双调用、
  // effect 双挂载与 key / hook 违规都只表现为 console 告警，不会让 DOM 断言失败。
  // 只打印等于放过，必须让它们把冒烟判失败。
  const rendererConsoleErrors = [];
  window.webContents.on('console-message', (_event, level, message) => {
    if (level < 2) return;
    console.error(`[renderer:${level}] ${message}`);
    rendererConsoleErrors.push(`[${level}] ${message}`);
  });

  try {
    console.log('[electron-p3-ui-smoke] load renderer');
    await window.loadFile(path.resolve('dist/index.html'));
    await waitFor(window, `Boolean(document.querySelector('button[title="主动收件箱"]'))`, '收件箱入口');
    await waitFor(window, `document.querySelector('[data-testid="inbox-unread-badge"]')?.textContent === '2'`, '未读角标');

    console.log('[electron-p3-ui-smoke] open inbox');
    await window.webContents.executeJavaScript(`document.querySelector('button[title="主动收件箱"]').click()`);
    await waitFor(window, `document.querySelectorAll('[data-testid="inbox-item"]').length === 3`, '收件箱列表');
    const listText = await window.webContents.executeJavaScript(`document.querySelector('[data-testid="proactive-inbox"]').innerText`);
    assert(listText.includes('需要处理 3'), '分区计数缺失');
    assert(listText.includes('承诺临期：回复客户报价') && listText.includes('紧急') && listText.includes('已弹窗'), '紧急卡片信息缺失');
    assert(listText.includes('对话运行失败') && listText.includes('本地文件已变化'), '普通卡片缺失');
    assert(!listText.includes('inbox_default') && !listText.includes('notified'), '收件箱泄露了内部路由原因');
    const defaultScreenshot = await capture(window, outputDirectory, 'p3_inbox_attention_default_verified.png');

    console.log('[electron-p3-ui-smoke] expand + open source');
    assert(await window.webContents.executeJavaScript(clickCard('对话运行失败')), '找不到卡片 对话运行失败');
    await waitFor(window, `document.body.innerText.includes('因为一次运行以错误结束')`, '事件解释');
    assert(await window.webContents.executeJavaScript(clickCardAction('处理')), '处理按钮缺失');
    await waitFor(window, `document.body.innerText.includes('运行记录')`, '设置页回链');
    assert(actions.openSource.includes('event-2'), '处理动作未通过 IPC 记录');
    const sourceScreenshot = await capture(window, outputDirectory, 'p3_inbox_open_source_verified.png');
    assert(await window.webContents.executeJavaScript(closeSettings), '设置抽屉关闭按钮缺失');
    await waitFor(window, `!document.body.innerText.includes('运行列表')`, '设置抽屉关闭');

    console.log('[electron-p3-ui-smoke] snooze and dismiss');
    assert(await window.webContents.executeJavaScript(clickCard('承诺临期：回复客户报价')), '找不到卡片 承诺临期：回复客户报价');
    await waitFor(window, `document.body.innerText.includes('因为这条承诺 24 小时内到期')`, '承诺解释');
    assert(await window.webContents.executeJavaScript(clickCardAction('稍后')), '稍后按钮缺失');
    await waitFor(window, `[...document.querySelectorAll('[data-testid="inbox-item"] button')].some((item) => item.textContent.trim() === '2 小时')`, '稍后档位');
    assert(await window.webContents.executeJavaScript(clickCardAction('2 小时')), '稍后档位缺失');
    await waitFor(window, `document.querySelector('[data-testid="proactive-inbox"]').innerText.includes('稍后 1')`, '稍后分区计数');
    assert(actions.snoozed.some(([id, minutes]) => id === 'event-1' && minutes === 120), '稍后动作未提交预设档位');

    assert(await window.webContents.executeJavaScript(clickCard('本地文件已变化：个人说明')), '找不到卡片 本地文件已变化：个人说明');
    await waitFor(window, `document.body.innerText.includes('因为本地文件比知识库里的版本新')`, '文档解释');
    assert(await window.webContents.executeJavaScript(clickCardAction('忽略')), '忽略按钮缺失');
    await waitFor(window, `document.querySelector('[data-testid="proactive-inbox"]').innerText.includes('已处理 1')`, '已处理分区计数');
    assert(actions.dismissed.includes('event-3'), '忽略动作未通过 IPC 记录');

    console.log('[electron-p3-ui-smoke] handled section + clear');
    await window.webContents.executeJavaScript(`[...document.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent.startsWith('已处理')).click()`);
    await waitFor(window, `document.body.innerText.includes('已忽略')`, '已处理列表');
    await window.webContents.executeJavaScript(`(() => { window.confirm = () => true; return true; })()`);
    assert(await window.webContents.executeJavaScript(clickButton('清除已处理')), '清除按钮缺失');
    await waitFor(window, `document.querySelector('[data-testid="inbox-empty"]')?.textContent.includes('还没有已处理的提示')`, '已处理空状态');
    assert(actions.cleared === 1, '清除动作未通过 IPC 记录');
    const emptyScreenshot = await capture(window, outputDirectory, 'p3_inbox_handled_empty_verified.png');

    console.log('[electron-p3-ui-smoke] push update changes badge');
    items.attention = [];
    window.webContents.send('proactivity:inbox:updated', { ts: Date.now(), unreadCount: 0 });
    await waitFor(window, `!document.querySelector('[data-testid="inbox-unread-badge"]')`, '角标清零');
    await window.webContents.executeJavaScript(`[...document.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent.startsWith('需要处理')).click()`);
    await waitFor(window, `document.querySelector('[data-testid="inbox-empty"]')?.textContent.includes('暂时没有需要处理的提示')`, '需要处理空状态');

    console.log('[electron-p3-ui-smoke] alternate theme + minimum window');
    items.attention = [{ event: events.run, lastRoute: 'inbox', lastRouteReason: 'inbox_default', deliveredAt: null, deferredUntil: null }];
    window.webContents.send('proactivity:inbox:updated', { ts: Date.now(), unreadCount: 1 });
    await waitFor(window, `document.querySelectorAll('[data-testid="inbox-item"]').length === 1`, '推送刷新列表');
    window.webContents.send('appearance:changed', violetAppearance);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const violetScreenshot = await capture(window, outputDirectory, 'p3_inbox_violet_verified.png');
    window.setSize(360, 520);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const layout = await window.webContents.executeJavaScript(`({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      hasItem: document.querySelectorAll('[data-testid="inbox-item"]').length === 1,
    })`);
    assert(layout.documentWidth <= layout.viewport, `最小窗口出现横向溢出: ${layout.documentWidth} > ${layout.viewport}`);
    assert(layout.hasItem, '最小窗口下收件箱内容丢失');
    const minimumScreenshot = await capture(window, outputDirectory, 'p3_inbox_minimum_verified.png');
    window.setSize(1200, 820);

    console.log('[electron-p3-ui-smoke] settings panel');
    await window.webContents.executeJavaScript(`document.querySelector('button[title="设置"]').click()`);
    await waitFor(window, `[...document.querySelectorAll('button')].some((item) => item.textContent.trim().endsWith('记忆'))`, '记忆导航');
    await window.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find((button) => button.textContent.trim().endsWith('记忆')).click()`);
    await waitFor(window, `document.body.innerText.includes('主动收件箱') && document.body.innerText.includes('每小时即时弹窗上限')`, '收件箱设置');
    await window.webContents.executeJavaScript(`(() => {
      const node = [...document.querySelectorAll('*')].find((item) => item.textContent.trim() === '静音的事件域');
      node.scrollIntoView({ block: 'center' });
    })()`);
    assert(await window.webContents.executeJavaScript(clickButton('知识文档')), '静音按钮缺失');
    await waitFor(window, `document.body.innerText.includes('🔇 知识文档')`, '静音状态');
    assert(performance.mutedEventDomains.includes('document'), '静音设置未通过 IPC 保存');
    const settingsScreenshot = await capture(window, outputDirectory, 'p3_inbox_settings_verified.png');

    assert(
      rendererConsoleErrors.length === 0,
      `渲染进程输出了 ${rendererConsoleErrors.length} 条 console 错误 / 告警：\n${rendererConsoleErrors.join('\n')}`,
    );
    console.log(JSON.stringify({
      ok: true,
      rendererDomVerified: true,
      rendererConsoleClean: true,
      unreadBadgeVerified: true,
      openSourceVerified: true,
      snoozeVerified: true,
      dismissVerified: true,
      clearHandledVerified: true,
      pushUpdateVerified: true,
      alternateThemeVerified: true,
      minimumWindowVerified: true,
      settingsVerified: true,
      screenshots: [defaultScreenshot, sourceScreenshot, emptyScreenshot, violetScreenshot, minimumScreenshot, settingsScreenshot],
    }, null, 2));
  } finally {
    window.destroy();
    app.quit();
  }
}).catch((error) => {
  console.error('[electron-p3-ui-smoke] 失败:', error);
  app.exit(1);
});
