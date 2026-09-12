const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');

const APP_NAME = 'The Shorekeeper';
const UNINSTALL_REGISTRY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: options.timeout ?? 120_000,
    env: options.env ?? process.env,
    cwd: options.cwd,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${path.basename(executable)} exited with ${result.status}: ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout;
}

function hasInstallRegistration() {
  const result = spawnSync(
    'reg.exe',
    ['query', UNINSTALL_REGISTRY, '/s', '/f', APP_NAME, '/d'],
    { encoding: 'utf8', windowsHide: true },
  );
  return result.status === 0 && result.stdout.includes(APP_NAME);
}

function appIsRunning() {
  const result = spawnSync(
    'tasklist.exe',
    ['/FI', `IMAGENAME eq ${APP_NAME}.exe`, '/NH'],
    { encoding: 'utf8', windowsHide: true },
  );
  return result.status === 0 && result.stdout.toLowerCase().includes('the shorekeeper.exe');
}

function shortcutPaths() {
  return [
    path.join(process.env.USERPROFILE, 'Desktop', `${APP_NAME}.lnk`),
    path.join(
      process.env.APPDATA,
      'Microsoft',
      'Windows',
      'Start Menu',
      'Programs',
      `${APP_NAME}.lnk`,
    ),
  ];
}

function assertNoExistingInstallation() {
  assert(!hasInstallRegistration(), 'Existing The Shorekeeper installation registration detected.');
  assert(!appIsRunning(), 'The Shorekeeper is currently running.');
  const existingShortcut = shortcutPaths().find((candidate) => fs.existsSync(candidate));
  assert(!existingShortcut, `Existing application shortcut detected: ${existingShortcut}`);
}

function sha256(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function waitUntil(predicate, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

function assertSafeTestRoot(testRoot) {
  const resolved = path.resolve(testRoot);
  const tempRoot = path.resolve(os.tmpdir());
  assert(
    resolved.startsWith(`${tempRoot}${path.sep}`)
      && path.basename(resolved).startsWith('shorekeeper-nsis-smoke-'),
    `Refusing to clean non-smoke directory: ${resolved}`,
  );
}

function verifyInstalledNative(installedExecutable, installRoot, workerPath) {
  const resources = path.join(installRoot, 'resources');
  const modulePath = path.join(resources, 'app.asar', 'node_modules', 'better-sqlite3');
  const nativeBinary = path.join(
    resources,
    'app.asar.unpacked',
    'node_modules',
    'better-sqlite3',
    'prebuilds',
    'win32-x64.node',
  );
  assert(fs.existsSync(nativeBinary), `Installed native binary is missing: ${nativeBinary}`);
  return run(installedExecutable, [workerPath, '--worker', modulePath], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    timeout: 30_000,
  }).trim();
}

function createExternalDatabase(databasePath) {
  const BetterSqlite3 = require('better-sqlite3');
  const db = new BetterSqlite3(databasePath);
  try {
    db.exec('CREATE TABLE sentinel (value TEXT NOT NULL)');
    db.prepare('INSERT INTO sentinel(value) VALUES (?)').run('preserve-after-uninstall');
  } finally {
    db.close();
  }
}

function findUninstaller(installRoot) {
  if (!fs.existsSync(installRoot)) return undefined;
  return fs
    .readdirSync(installRoot)
    .find((name) => /^uninstall.*\.exe$/i.test(name));
}

function main() {
  assert(process.platform === 'win32', 'NSIS lifecycle smoke only supports Windows.');
  assertNoExistingInstallation();

  const root = path.resolve(__dirname, '..');
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
  );
  assert(
    typeof packageJson.version === 'string' && /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(packageJson.version),
    'package.json contains an invalid version.',
  );
  const installer = path.join(
    root,
    'release',
    `${APP_NAME} Setup ${packageJson.version}.exe`,
  );
  const workerPath = path.join(root, 'scripts', 'packaged-native-sqlite-smoke.cjs');
  assert(fs.existsSync(installer), `NSIS installer is missing: ${installer}`);

  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shorekeeper-nsis-smoke-'));
  const installRoot = path.join(testRoot, 'app');
  const externalDataRoot = path.join(testRoot, 'external-data');
  const externalDatabase = path.join(externalDataRoot, 'shorekeeper.db');
  const installedExecutable = path.join(installRoot, `${APP_NAME}.exe`);
  fs.mkdirSync(externalDataRoot, { recursive: true });
  createExternalDatabase(externalDatabase);
  const databaseHash = sha256(externalDatabase);
  let uninstalled = false;

  try {
    run(installer, ['/S', `/D=${installRoot}`]);
    assert(fs.existsSync(installedExecutable), 'First NSIS installation did not create the app.');
    assert(hasInstallRegistration(), 'First NSIS installation did not create uninstall registration.');
    const firstInstallProbe = verifyInstalledNative(installedExecutable, installRoot, workerPath);

    run(installer, ['/S', `/D=${installRoot}`]);
    assert(fs.existsSync(installedExecutable), 'NSIS upgrade removed the application executable.');
    const upgradeProbe = verifyInstalledNative(installedExecutable, installRoot, workerPath);

    const uninstallerName = findUninstaller(installRoot);
    assert(uninstallerName, 'Installed NSIS uninstaller was not found.');
    run(path.join(installRoot, uninstallerName), ['/S'], { timeout: 60_000 });
    waitUntil(
      () => !fs.existsSync(installedExecutable) && !hasInstallRegistration(),
      30_000,
      'NSIS executable and registration cleanup',
    );
    uninstalled = true;

    assert(fs.existsSync(externalDatabase), 'External database was removed by uninstall.');
    assert(sha256(externalDatabase) === databaseHash, 'External database changed during install lifecycle.');
    assert(!hasInstallRegistration(), 'Uninstall registration remains after uninstall.');
    const remainingShortcut = shortcutPaths().find((candidate) => fs.existsSync(candidate));
    assert(!remainingShortcut, `Application shortcut remains after uninstall: ${remainingShortcut}`);

    console.log(JSON.stringify({
      firstInstall: true,
      upgrade: true,
      uninstall: true,
      externalDatabasePreserved: true,
      externalDatabaseSha256: databaseHash,
      firstInstallProbe: JSON.parse(firstInstallProbe),
      upgradeProbe: JSON.parse(upgradeProbe),
    }, null, 2));
  } finally {
    if (!uninstalled) {
      const uninstallerName = findUninstaller(installRoot);
      if (uninstallerName) {
        spawnSync(path.join(installRoot, uninstallerName), ['/S'], {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 60_000,
        });
        try {
          waitUntil(() => !hasInstallRegistration(), 30_000, 'NSIS failure cleanup');
        } catch {
          // Keep diagnostics when the uninstaller cannot complete cleanup.
        }
      }
    }
    if (!hasInstallRegistration()) {
      assertSafeTestRoot(testRoot);
      fs.rmSync(testRoot, { recursive: true, force: true });
    } else {
      console.error(`NSIS cleanup is incomplete; diagnostics retained at ${testRoot}`);
    }
  }
}

main();
