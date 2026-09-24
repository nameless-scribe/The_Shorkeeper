import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ErpBrowserRuntime } from '../electron/erp/browser-runtime';
import { configureErpConnectionService, shutdownErpConnectionService } from '../electron/erp/service';
import { initDatabase, closeDatabaseAsync } from '../src/db';
import { configureDbRuntime } from '../src/db/runtime-paths';
import { setSetting } from '../src/db/app-settings';
import { createErpReportDraft, listErpReportSubmissions } from '../src/db/repositories/erp-work-reports';
import { createApproval, createTaskRun, decideApproval, startTaskRunStep } from '../src/db/repositories/task-runs';
import { digestErpPayload } from '../src/erp/contracts';
import { executeErpSubmission, previewErpSubmission } from '../src/erp/submission-service';
import {
  cancelErpTimeEntryForm,
  closeErpTimeEntryList,
  openAndFillErpTimeEntryForm,
  submitFilledErpTimeEntryForm,
} from '../electron/erp/taskboard-adapter';

const taskName = 'APS 自动排产系统调整';
const content = '本地模拟报工，不访问真实 ERP。';
const html = `<!doctype html><html><head><meta charset="utf-8"><title>ERP package smoke</title></head>
<body><main id="app"></main><script>
const app=document.querySelector('#app');
function shell(title,body){const d=document.createElement('div');d.setAttribute('role','dialog');
d.innerHTML='<div class="el-dialog__title">'+title+'</div><button class="el-dialog__headerbtn">关闭</button>'+body;
d.querySelector('.el-dialog__headerbtn').onclick=()=>d.remove();document.body.appendChild(d);return d}
function row(label,input){return '<div class="el-form-item"><label class="el-form-item__label">'+label+'</label>'+input+'</div>'}
function form(){const d=shell('新增报工',row('任务名称','<input value="${taskName}" disabled>')+
row('日期','<input>')+row('工时','<input>')+row('工作内容','<textarea></textarea>')+
'<button id="ok">确 定</button><button id="cancel">取 消</button>');
d.querySelector('#cancel').onclick=()=>d.remove();
d.querySelector('#ok').onclick=async()=>{
  const values=d.querySelectorAll('input');
  const response=await fetch('/business/time-entry',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({taskId:'1001',workDate:values[1].value,workHours:Number(values[2].value),
      workContent:d.querySelector('textarea').value})});
  if(response.ok)d.remove();
}}
function openList(){const d=shell('工时记录：${taskName}','<button id="add">新增报工</button>');
d.querySelector('#add').onclick=form}
function board(){document.cookie='GTerp-Token=smoke-token; path=/';history.pushState({},'', '/taskboard/index');
app.innerHTML='<div data-task-block="1001"><div class="spread-cell editable col-hours">3h</div>'+ 
'<div class="spread-cell editable col-hours">0h</div></div>';
document.querySelectorAll('.col-hours')[1].onclick=openList}
app.innerHTML='<button id="login">登录</button>';document.querySelector('#login').onclick=board;
</script></body></html>`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const appAsar = process.argv[2];
  const packagedMain = path.join(process.argv[2], 'dist-electron', 'main.js');
  assert(fs.existsSync(packagedMain), '打包产物缺少主进程入口');
  const packagedMainSha256 = createHash('sha256').update(fs.readFileSync(packagedMain)).digest('hex');
  const writes: unknown[] = [];
  const entries: Array<Record<string, unknown>> = [];
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (pathname.startsWith('/prod-api/')) {
      if (request.headers.authorization !== 'Bearer smoke-token') {
        response.writeHead(401); response.end(); return;
      }
      let body: unknown;
      if (pathname === '/prod-api/getInfo') body = { code: 200, user: { userId: 7, userName: '模拟用户' } };
      else if (pathname === '/prod-api/business/task/board') body = { code: 200, data: [{
        taskId: 1001, taskName, projectName: '模拟项目', ownerId: 7, ownerName: '模拟用户', actualHours: entries.length * 0.5,
      }] };
      else if (pathname === '/prod-api/business/time-entry/list') body = { total: entries.length, rows: entries };
      else { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(body)); return;
    }
    if (request.method === 'POST' && request.url === '/business/time-entry') {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      writes.push(input);
      entries.push({ timeEntryId: 101 + entries.length, taskId: Number(input.taskId), ownerId: 7,
        workDate: input.workDate, workHour: input.workHours, workContent: input.workContent, createBy: '模拟用户' });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ code: 200, data: { id: 'local-entry-1' } }));
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(html);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address !== 'string', '本地模拟站点未启动');
  const origin = `http://127.0.0.1:${address.port}`;
  const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shorekeeper-packaged-erp-profile-'));
  const runtime = new ErpBrowserRuntime({ userDataRoot: profileRoot, channel: 'msedge' });
  let databaseOpened = false;
  try {
    await runtime.connect(origin);
    await runtime.runExclusive(async (page) => {
      await page.getByRole('button', { name: '登录', exact: true }).click();
      const input = { origin, taskId: '1001', taskName, workDate: '2026-09-21',
        workMinutes: 30, workContent: content };
      const cancelled = await openAndFillErpTimeEntryForm(page, input);
      assert(cancelled.workMinutes === 30, '取消前表单回读工时不符');
      await cancelErpTimeEntryForm(page);
      await closeErpTimeEntryList(page);
      assert(writes.length === 0, '取消操作意外写入了模拟 ERP');
      const submitted = await openAndFillErpTimeEntryForm(page, input);
      assert(submitted.workContent === content, '提交前表单回读内容不符');
      await submitFilledErpTimeEntryForm(page, origin);
      await closeErpTimeEntryList(page);
    });
    assert(writes.length === 1, `模拟 ERP 收到 ${writes.length} 次新增，预期 1 次`);
    const written = writes[0] as Record<string, unknown>;
    assert(written.taskId === '1001' && written.workDate === '2026-09-21'
      && written.workHours === 0.5 && written.workContent === content, '模拟 ERP 收到的报工内容不符');
    await runtime.close();

    configureDbRuntime({ isPackaged: true, appPath: appAsar, resourcesPath: path.dirname(appAsar) });
    await initDatabase(path.join(profileRoot, 'smoke.db'));
    databaseOpened = true;
    setSetting('erp.enabled', '1');
    setSetting('erp.origin', origin);
    setSetting('erp.apiPrefix', '/prod-api');
    const service = configureErpConnectionService(profileRoot);
    await service.connect();
    const serviceRuntime = (service as unknown as { runtime: ErpBrowserRuntime }).runtime;
    await serviceRuntime.runExclusive(async (page) => {
      await page.getByRole('button', { name: '登录', exact: true }).click();
    });
    assert((await service.refresh()).state === 'authenticated', '模拟 ERP 登录状态未通过身份回读');

    const item = { itemId: 'smoke-item', taskId: '1001', taskName, projectName: '模拟项目',
      workMinutes: 30, workContent: '打包态完整流程模拟。', durationEstimated: false, sourceMessageIds: ['smoke-message'] };
    const draft = createErpReportDraft({ sessionId: 'smoke-session', connectionKey: 'smoke-connection',
      erpOrigin: origin, erpUserId: '7', workDate: '2026-09-21', items: [item] });
    const request = { draftId: draft.id, draftRevision: 1, allowPossibleDuplicate: false };
    const preview = await previewErpSubmission(request, 'smoke-session');
    assert(preview.erpWorkReport?.existingMinutes === 30 && preview.erpWorkReport.totalMinutes === 60,
      '提交前预览未读取模拟 ERP 的已有工时');
    const rawArgs = { draft_id: draft.id, draft_revision: 1 };
    const argsDigest = digestErpPayload(rawArgs);
    createTaskRun({ id: 'smoke-run', sessionId: 'smoke-session' });
    startTaskRunStep({ runId: 'smoke-run', callId: 'smoke-call', toolName: 'submit_erp_report', riskLevel: 'high' });
    const approval = createApproval({ runId: 'smoke-run', sessionId: 'smoke-session', callId: 'smoke-call',
      toolName: 'submit_erp_report', args: rawArgs, argsDigest, previewRevision: preview.revision, riskLevel: 'high' });
    const authorization = { sessionId: 'smoke-session', runId: 'smoke-run',
      stepId: 'smoke-run:smoke-call', callId: 'smoke-call', approvalId: approval.id, argsDigest,
      previewRevision: preview.revision, toolName: 'submit_erp_report', signal: new AbortController().signal };
    let rejectedWithoutApproval = false;
    try {
      await executeErpSubmission(request, authorization);
    } catch (error) {
      rejectedWithoutApproval = error instanceof Error && error.message.includes('审批');
    }
    assert(rejectedWithoutApproval && writes.slice().length === 1, '未经批准的模拟报工不应写入');
    decideApproval(approval.id, 'approved', 'user');
    const submitted = await executeErpSubmission(request, authorization);
    assert(submitted.verified === 1 && writes.slice().length === 2, '批准后的模拟 ERP 报工未唯一核验');
    const ledger = listErpReportSubmissions(submitted.batchId);
    assert(ledger.length === 1 && ledger[0].state === 'verified' && ledger[0].remoteTimeEntryId === '102',
      '报工账本未记录模拟 ERP 的新记录 ID');
    console.log(JSON.stringify({ ok: true, cancelledWithoutWrite: true, rejectedWithoutApproval, writes: writes.length,
      approvedFlowVerified: true, ledgerState: ledger[0].state,
      packagedPlaywrightPath: require.resolve('playwright-core'), packagedMainSha256 }));
  } finally {
    try {
      await runtime.close();
      await shutdownErpConnectionService();
      if (databaseOpened) await closeDatabaseAsync();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      const resolved = path.resolve(profileRoot);
      assert(resolved.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`)
        && path.basename(resolved).startsWith('shorekeeper-packaged-erp-profile-'), '拒绝清理非测试目录');
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
