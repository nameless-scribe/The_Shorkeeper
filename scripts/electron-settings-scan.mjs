/**
 * 真实应用的设置页扫描（`pnpm test:settings:scan`，先 `pnpm build`）。
 *
 * 启动 dist-electron/main.js（临时数据目录与工作区，不碰真实数据），开 DevTools 协议端口，
 * 打开设置抽屉逐个页签：截图、统计控件、检测被别的元素遮住的控件（elementFromPoint 不是控件自己）、
 * 点击每个非破坏性按钮，收集渲染进程 console 错误与未捕获异常。
 *
 * 环境变量：SCAN_W / SCAN_H 视口尺寸（默认 420×720，即聊天窗默认大小）。
 * 退出码 1：任一页签出现 console 错误 / 异常，或有控件被遮挡（视口边缘外的不算）。
 * 产物：临时目录里的 report.json、shots/、main.log，路径打印在结果里。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const port = 9333;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-settings-scan-'));
const workspaceDir = path.join(dataDir, 'workspace');
fs.mkdirSync(workspaceDir, { recursive: true });
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shorekeeper-settings-scan-'));
const shotDir = path.join(outDir, 'shots');
fs.rmSync(shotDir, { recursive: true, force: true });
fs.mkdirSync(shotDir, { recursive: true });

const DANGEROUS = /删除|清空|重置|移除|退出|卸载|注销|关闭|取消|停止|断开|重新索引|重建|清理|拒绝|回滚|恢复|安装|更新|下载|检查更新|重新加载|刷新页面/;

const child = spawn(
  path.join(repo, 'node_modules/electron/dist/electron.exe'),
  [path.join(repo, 'dist-electron/main.js'), `--remote-debugging-port=${port}`],
  {
    cwd: repo,
    env: {
      ...process.env,
      SHOREKEEPER_DB_DIR: dataDir,
      SHOREKEEPER_DB_PATH: path.join(dataDir, 'shorekeeper.db'),
      SHOREKEEPER_WORKSPACE_DIR: workspaceDir,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
const mainLog = [];
const mainLogFile = fs.createWriteStream(path.join(outDir, 'main.log'));
child.stdout.on('data', (d) => { mainLog.push(String(d)); mainLogFile.write(d); });
child.stderr.on('data', (d) => { mainLog.push(String(d)); mainLogFile.write(d); });
child.on('exit', (code, signal) => { mainLogFile.write(`\n[child exit] code=${code} signal=${signal}\n`); });
const progress = (m) => { console.error(`[settings-scan] ${m}`); };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findChatTarget() {
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page' && /index\.html(\?|$)/.test(t.url) && !/panel=/.test(t.url));
      if (page) return page;
    } catch {}
    await sleep(500);
  }
  throw new Error('chat window target not found');
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; this.errors = [];
    ws.on('close', () => { for (const { reject } of this.pending.values()) reject(new Error('devtools socket closed')); this.pending.clear(); });
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.id && this.pending.has(msg.id)) { const { resolve, reject } = this.pending.get(msg.id); this.pending.delete(msg.id); msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result); }
      else if (msg.method) {
        if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) {
          this.errors.push({ kind: msg.params.type, text: msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300) });
        }
        if (msg.method === 'Runtime.exceptionThrown') {
          this.errors.push({ kind: 'exception', text: (msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text ?? '').slice(0, 300) });
        }
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
  async shot(name) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(shotDir, name), Buffer.from(data, 'base64'));
  }
  drainErrors() { const e = this.errors; this.errors = []; return e; }
}

// 页面内探针：控件清单 + 遮挡检测
const PROBE = `(() => {
  const isVisible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && r.bottom > 0 && r.top < innerHeight; };
  // 只扫设置抽屉本身（侧栏的父容器），不碰下面的聊天页与窗口标题栏
  const aside = document.querySelector('aside');
  const root = aside ? aside.parentElement : document.body;
  const controls = [...root.querySelectorAll('button, select, input, textarea, a[href]')].filter(isVisible);
  return controls.map((el, index) => {
    const r = el.getBoundingClientRect();
    const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
    const top = document.elementFromPoint(cx, cy);
    // 命中祖先说明控件只是被滚动容器裁掉一部分（在视口边缘），不是被别的元素盖住
    const covered = top ? !(top === el || el.contains(top) || top.contains(el)) : true;
    const coveredBy = covered && top ? (top.tagName.toLowerCase() + (top.className && typeof top.className === 'string' ? '.' + top.className.split(' ').slice(0, 3).join('.') : '')) : null;
    el.setAttribute('data-scan-index', String(index));
    return {
      index, tag: el.tagName.toLowerCase(), type: el.getAttribute('type') || '', text: (el.innerText || el.getAttribute('title') || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().slice(0, 40),
      title: (el.getAttribute('title') || el.getAttribute('aria-label') || '').trim(),
      disabled: el.disabled === true, covered, coveredBy, appRegion: getComputedStyle(el).webkitAppRegion || '',
    };
  });
})()`;

const CLICK = (index) => `(() => { const el = document.querySelector('[data-scan-index="${index}"]'); if (!el) return 'missing'; el.scrollIntoView({ block: 'center' }); el.click(); return 'clicked'; })()`;

const report = { dataDir, tabs: [], mainLogTail: null };

/** 视口边缘外（elementFromPoint 为 null）的控件只是没滚到，不算遮挡 */
function realCovered(entry) {
  return entry.covered.filter((item) => !item.endsWith('← null'));
}
function hasProblems(r) {
  if (r.fatal) return true;
  if ((r.startupErrors || []).length) return true;
  if (r.reconnects) return true;
  return (r.tabs || []).some((t) => t.errors.length > 0 || realCovered(t).length > 0);
}
function summarize(r, reportPath) {
  return {
    ok: !hasProblems(r),
    viewport: r.viewport,
    reportPath,
    fatal: r.fatal ? String(r.fatal).split('\n')[0] : null,
    startupErrors: (r.startupErrors || []).length,
    reconnects: r.reconnects || 0,
    tabs: (r.tabs || []).map((t) => ({
      tab: t.tab.replace(/\n/g, ' '),
      controls: t.controls,
      clicked: t.clicked,
      covered: realCovered(t),
      errors: t.errors.map((e) => ({ button: e.button, errors: e.errors.map((x) => `${x.kind}: ${x.text.slice(0, 160)}`) })),
    })),
    mainLogTail: (r.mainLogTail || []).slice(-10),
  };
}
try {
  // 渲染页面若被重载（ErrorBoundary 的"重新加载"、导航），DevTools 目标会换；连接封装成函数以便重连
  const connect = async () => {
    const target = await findChatTarget();
    const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
    await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
    const session = new Cdp(ws);
    await session.send('Runtime.enable');
    await session.send('Page.enable');
    return session;
  };
  let cdp = await connect();
  report.reconnects = 0;
  // 等首页就绪并让窗口足够大
  const VW = Number(process.env.SCAN_W || 420), VH = Number(process.env.SCAN_H || 720);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: false });
  report.viewport = { width: VW, height: VH };
  for (let i = 0; i < 60; i += 1) {
    const ready = await cdp.eval(`!!document.querySelector('button[title*="设置"], button[aria-label*="设置"]')`);
    if (ready) break;
    await sleep(500);
  }
  report.startupErrors = cdp.drainErrors();
  await cdp.shot('00-home.png');
  await cdp.eval(`(document.querySelector('button[title*="设置"], button[aria-label*="设置"]')).click()`);
  await sleep(600);
  const tabs = await cdp.eval(`[...document.querySelectorAll('nav button, aside button')].map((b) => b.innerText.trim()).filter(Boolean)`);
  report.sidebar = tabs;
  const tabButtons = await cdp.eval(`(() => { const list = [...document.querySelectorAll('nav button, aside button')]; list.forEach((b, i) => b.setAttribute('data-tab-index', String(i))); return list.map((b) => b.innerText.trim()); })()`);

  for (let t = 0; t < tabButtons.length; t += 1) {
    const label = tabButtons[t];
    progress(`tab ${t + 1}/${tabButtons.length}: ${label}`);
    const entry = { tab: label, controls: 0, covered: [], disabled: 0, clicked: 0, skipped: [], errors: [] };
    if (cdp.ws.readyState !== WebSocket.OPEN) {
      // 目标换了：重连、重开设置抽屉、重新给页签编号
      report.reconnects += 1;
      entry.reconnected = true;
      await sleep(1500);
      cdp = await connect();
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: false });
      await sleep(800);
      await cdp.eval(`(document.querySelector('button[title*="设置"], button[aria-label*="设置"]'))?.click()`);
      await sleep(600);
      await cdp.eval(`(() => { const list = [...document.querySelectorAll('nav button, aside button')]; list.forEach((b, i) => b.setAttribute('data-tab-index', String(i))); })()`);
    }
    await cdp.eval(`document.querySelector('[data-tab-index="${t}"]')?.click()`);
    await sleep(900);
    // 上一页签的点击可能滚动了内容区；滚回顶部，免得滚到抽屉头部下面的控件被误判为遮挡
    await cdp.eval(`(() => { const aside = document.querySelector('aside'); const scroller = aside?.parentElement?.querySelector('.overflow-y-auto'); if (scroller) scroller.scrollTop = 0; })()`);
    await sleep(100);
    cdp.drainErrors();
    await cdp.shot(`${String(t + 1).padStart(2, '0')}-${label.replace(/[^\\w\\u4e00-\\u9fff]/g, '')}.png`);
    const controls = await cdp.eval(PROBE);
    entry.controls = controls.length;
    entry.selects = controls.filter((c) => c.tag === 'select').map((c) => ({ text: c.text, covered: c.covered, coveredBy: c.coveredBy, disabled: c.disabled }));
    entry.covered = controls.filter((c) => c.covered).map((c) => `${c.tag}:${c.text || c.type} ← ${c.coveredBy}`);
    entry.disabled = controls.filter((c) => c.disabled).length;
    entry.appRegionDrag = controls.filter((c) => c.appRegion === 'drag').map((c) => `${c.tag}:${c.text}`);
    for (const c of controls) {
      if (c.tag !== 'button' || c.disabled) continue;
      // 侧栏页签、关闭按钮不点；破坏性动作不点
      if (DANGEROUS.test(c.text) || DANGEROUS.test(c.title) || /^[✕─×]$/.test(c.text) || tabButtons.includes(c.text)) { entry.skipped.push(c.text || c.title); continue; }
      const before = cdp.drainErrors();
      progress(`  click ${c.text || c.type}`);
      const r = await cdp.eval(CLICK(c.index));
      await sleep(250);
      const errs = cdp.drainErrors();
      entry.clicked += r === 'clicked' ? 1 : 0;
      if (errs.length) entry.errors.push({ button: c.text, errors: errs });
      // 若弹出了对话框（role=dialog），按 Esc 关掉，避免挡住后续控件
      const dialog = await cdp.eval(`!!document.querySelector('[role="dialog"]')`);
      if (dialog) { await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(200); }
      // 页签可能被点击改变（例如"打开 Worldbook"），切回本页签
      await cdp.eval(`document.querySelector('[data-tab-index="${t}"]')?.click()`);
      await sleep(150);
    }
    report.tabs.push(entry);
  }
  if (cdp.ws.readyState === WebSocket.OPEN) await cdp.shot('99-end.png');
} catch (error) {
  report.fatal = String(error && error.stack || error);
} finally {
  report.mainLogTail = mainLog.join('').split('\n').filter((l) => /error|Error|失败|警告|warn/i.test(l)).slice(-40);
  const reportPath = path.join(outDir, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  child.kill();
  await sleep(500);
  fs.rmSync(dataDir, { recursive: true, force: true });
  console.log(JSON.stringify(summarize(report, reportPath), null, 2));
  if (hasProblems(report)) process.exitCode = 1;
}
