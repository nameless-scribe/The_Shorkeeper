const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const electron = require('electron');
const env = { ...process.env, SHOREKEEPER_SMOKE_FORCE_FAILURE: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const result = spawnSync(electron, [path.join(__dirname, 'electron-erp-ui-smoke.cjs')], {
  cwd: path.resolve(__dirname, '..'),
  encoding: 'utf8',
  timeout: 30_000,
  windowsHide: true,
  env,
});
if (result.error) throw result.error;
assert.match(`${result.stdout}\n${result.stderr}`, /ERP UI smoke intentional failure/);
assert.equal(result.status, 1, `冒烟测试失败时应返回 1，实际返回 ${result.status}`);
console.log('ERP Electron 冒烟测试失败路径正确返回退出码 1');
