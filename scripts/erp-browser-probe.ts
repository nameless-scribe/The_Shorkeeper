import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ErpBrowserRuntime } from '../electron/erp/browser-runtime';
import { cancelErpTimeEntryForm, openAndFillErpTimeEntryForm } from '../electron/erp/taskboard-adapter';

const html = `<!doctype html><html><head><meta charset="utf-8"><title>ERP probe</title></head>
<body><main id="app"></main><script>
const app=document.querySelector('#app');
function login(){app.innerHTML='<label>账号<input aria-label="账号"></label><label>密码<input aria-label="密码" type="password"></label><button id="login">登录</button>';document.querySelector('#login').onclick=board}
function board(){history.pushState({},'', '/taskboard/index');app.innerHTML='<div data-task-block="1001"><div class="spread-cell editable col-hours">3h</div><div class="spread-cell editable col-hours">0h</div></div>';document.querySelectorAll('.col-hours')[1].onclick=openList}
function shell(title,body){const d=document.createElement('div');d.setAttribute('role','dialog');d.innerHTML='<span class="el-dialog__title">'+title+'</span>'+body;document.body.appendChild(d);return d}
function openList(){shell('工时记录：APS 自动排产系统调整','<button id="add">新增报工</button>');document.querySelector('#add').onclick=openForm}
function row(label,input){return '<div class="el-form-item"><label class="el-form-item__label">'+label+'</label>'+input+'</div>'}
function openForm(){const d=shell('新增报工',row('任务名称','<input value="APS 自动排产系统调整" disabled>')+row('日期','<input>')+row('工时','<input>')+row('工作内容','<textarea></textarea>')+'<button id="ok">确 定</button><button id="cancel">取 消</button>');d.querySelector('#cancel').onclick=()=>d.remove()}
login();
</script></body></html>`;

const server = http.createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  response.end(html);
});

await new Promise<void>((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
if (!address || typeof address === 'string') throw new Error('无法启动 ERP 模拟站点');
const origin = `http://127.0.0.1:${address.port}`;
const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shorekeeper-erp-probe-'));
const runtime = new ErpBrowserRuntime({ userDataRoot: probeRoot, channel: 'msedge' });

try {
  await runtime.connect(origin);
  const snapshot = await runtime.runExclusive(async (page) => {
    await page.getByRole('button', { name: '登录', exact: true }).click();
    const result = await openAndFillErpTimeEntryForm(page, {
      origin, taskId: '1001', taskName: 'APS 自动排产系统调整', workDate: '2026-09-21',
      workMinutes: 30, workContent: '模拟环境填写，不会访问或写入真实 ERP。',
    });
    await cancelErpTimeEntryForm(page);
    return result;
  });
  process.stdout.write(`${JSON.stringify({ ok: true, snapshot })}\n`);
} finally {
  await runtime.close().catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(probeRoot, { recursive: true, force: true });
}
