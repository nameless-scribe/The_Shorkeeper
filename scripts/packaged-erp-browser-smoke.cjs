const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');

function assert(condition, message) { if (!condition) throw new Error(message); }

async function main() {
  const root = path.resolve(__dirname, '..');
  const packageRoot = path.resolve(process.argv[2] || path.join(root, 'release', 'win-unpacked'));
  const executable = path.join(packageRoot, 'The Shorekeeper.exe');
  const appAsar = path.join(packageRoot, 'resources', 'app.asar');
  assert(fs.existsSync(executable), `缺少打包程序：${executable}`);
  assert(fs.existsSync(appAsar), `缺少 app.asar：${appAsar}`);

  const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shorekeeper-packaged-erp-probe-'));
  try {
    const { build } = await import('vite');
    await build({
      configFile: false,
      root,
      logLevel: 'error',
      build: {
        target: 'node24',
        minify: false,
        outDir: probeRoot,
        emptyOutDir: false,
        lib: {
          entry: path.join(root, 'scripts', 'packaged-erp-flow-probe.ts'),
          formats: ['cjs'],
          fileName: () => 'erp-probe.cjs',
        },
        rollupOptions: { external: (id) => id === 'playwright-core' || id.startsWith('node:') },
      },
    });
    const worker = path.join(probeRoot, 'erp-probe.cjs');
    assert(fs.existsSync(worker), 'ERP 模拟 worker 构建失败');
    const result = spawnSync(executable, [worker, appAsar], {
      cwd: probeRoot,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 120_000,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_PATH: path.join(appAsar, 'node_modules') },
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`打包态 ERP 模拟失败（exit ${result.status}）：${result.stderr || result.stdout}`);
    }
    const lastLine = result.stdout.trim().split(/\r?\n/).at(-1);
    const evidence = JSON.parse(lastLine);
    assert(evidence.ok && evidence.cancelledWithoutWrite && evidence.writes === 1, '模拟提交证据不完整');
    const localMainSha256 = createHash('sha256')
      .update(fs.readFileSync(path.join(root, 'dist-electron', 'main.js'))).digest('hex');
    assert(evidence.packagedMainSha256 === localMainSha256, '打包主进程入口不是当前构建，请重新打包');
    const packagedDependency = path.resolve(String(evidence.packagedPlaywrightPath)).toLowerCase();
    assert(packagedDependency.startsWith(`${path.resolve(appAsar).toLowerCase()}${path.sep}`),
      `Playwright 没有从打包产物加载：${evidence.packagedPlaywrightPath}`);
    console.log(JSON.stringify({ ...evidence, packageRoot }));
  } finally {
    const resolved = path.resolve(probeRoot);
    assert(resolved.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`)
      && path.basename(resolved).startsWith('shorekeeper-packaged-erp-probe-'), '拒绝清理非测试目录');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
