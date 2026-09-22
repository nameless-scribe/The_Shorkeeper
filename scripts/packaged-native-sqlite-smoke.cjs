const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function removeTemporaryDirectory(directory) {
  const resolved = path.resolve(directory);
  const tempRoot = path.resolve(os.tmpdir());
  assert(
    resolved.startsWith(`${tempRoot}${path.sep}`)
      && path.basename(resolved).startsWith('shorekeeper-packaged-native-'),
    `Refusing to clean non-smoke directory: ${resolved}`,
  );
  fs.rmSync(resolved, { recursive: true, force: true });
}

function runWorker(modulePath) {
  const BetterSqlite3 = require(modulePath);
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'shorekeeper-packaged-native-'),
  );
  const databasePath = path.join(temporaryDirectory, 'packaged.db');
  const db = new BetterSqlite3(databasePath);
  try {
    const journalMode = db.pragma('journal_mode = WAL', { simple: true });
    db.exec("CREATE VIRTUAL TABLE probe USING fts5(content, tokenize='trigram')");
    db.prepare('INSERT INTO probe(content) VALUES (?)').run('守岸人私人助理知识库');
    const hit = db.prepare('SELECT content FROM probe WHERE probe MATCH ?').get('知识库');
    assert(journalMode === 'wal', `Expected WAL, received ${journalMode}`);
    assert(hit?.content === '守岸人私人助理知识库', 'Packaged trigram FTS probe failed');
    console.log(JSON.stringify({
      electron: process.versions.electron,
      node: process.versions.node,
      abi: process.versions.modules,
      sqlite: db.prepare('SELECT sqlite_version() AS version').get().version,
      packagedModuleLoaded: true,
      trigramSearch: true,
    }));
  } finally {
    db.close();
    removeTemporaryDirectory(temporaryDirectory);
  }
}

function runController() {
  const root = path.resolve(__dirname, '..');
  const unpackedRoot = path.resolve(process.argv[2] || path.join(root, 'release', 'win-unpacked'));
  const executable = path.join(unpackedRoot, 'The Shorekeeper.exe');
  const resources = path.join(unpackedRoot, 'resources');
  const appAsar = path.join(resources, 'app.asar');
  const modulePath = path.join(appAsar, 'node_modules', 'better-sqlite3');
  const nativeBinary = path.join(
    resources,
    'app.asar.unpacked',
    'node_modules',
    'better-sqlite3',
    'prebuilds',
    'win32-x64.node',
  );

  assert(fs.existsSync(executable), `Missing packaged executable: ${executable}`);
  assert(fs.existsSync(appAsar), `Missing app.asar: ${appAsar}`);
  assert(fs.existsSync(nativeBinary), `Missing unpacked native binary: ${nativeBinary}`);

  const result = spawnSync(executable, [__filename, '--worker', modulePath], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    timeout: 30_000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Packaged native smoke failed with exit ${result.status}: ${result.stderr || result.stdout}`,
    );
  }
  process.stdout.write(result.stdout);
}

if (process.argv[2] === '--worker') {
  runWorker(process.argv[3]);
} else {
  runController();
}
