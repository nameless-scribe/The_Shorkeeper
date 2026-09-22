import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ErpBrowserRuntime } from '../electron/erp/browser-runtime';
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
function board(){history.pushState({},'', '/taskboard/index');
app.innerHTML='<div data-task-block="1001"><div class="spread-cell editable col-hours">3h</div>'+ 
'<div class="spread-cell editable col-hours">0h</div></div>';
document.querySelectorAll('.col-hours')[1].onclick=openList}
app.innerHTML='<button id="login">登录</button>';document.querySelector('#login').onclick=board;
</script></body></html>`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const packagedMain = path.join(process.argv[2], 'dist-electron', 'main.js');
  assert(fs.existsSync(packagedMain), '打包产物缺少主进程入口');
  const packagedMainSha256 = createHash('sha256').update(fs.readFileSync(packagedMain)).digest('hex');
  const writes: unknown[] = [];
  const server = http.createServer(async (request, response) => {
    if (request.method === 'POST' && request.url === '/business/time-entry') {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      writes.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
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
    console.log(JSON.stringify({ ok: true, cancelledWithoutWrite: true, writes: writes.length,
      packagedPlaywrightPath: require.resolve('playwright-core'), packagedMainSha256 }));
  } finally {
    try {
      await runtime.close();
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
