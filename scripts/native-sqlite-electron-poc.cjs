const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function removeTemporaryDirectory(directory) {
  const resolvedDirectory = path.resolve(directory);
  const resolvedTemp = path.resolve(os.tmpdir());
  assert(
    resolvedDirectory.startsWith(`${resolvedTemp}${path.sep}`) &&
      path.basename(resolvedDirectory).startsWith('shorekeeper-electron-db-'),
    `Refusing to clean non-PoC directory: ${resolvedDirectory}`,
  );
  fs.rmSync(resolvedDirectory, { recursive: true, force: true });
}

app.disableHardwareAcceleration();

app.whenReady().then(() => {
  const modulePath = process.env.SHOREKEEPER_BETTER_SQLITE3_PATH;
  assert(modulePath, 'SHOREKEEPER_BETTER_SQLITE3_PATH is required');
  const BetterSqlite3 = require(modulePath);
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'shorekeeper-electron-db-'),
  );
  const db = new BetterSqlite3(path.join(temporaryDirectory, 'electron-poc.db'));

  try {
    db.pragma('journal_mode = WAL');
    db.exec("CREATE VIRTUAL TABLE search_probe USING fts5(content, tokenize='trigram')");
    db.prepare('INSERT INTO search_probe(content) VALUES (?)').run('守岸人私人助理知识库');
    const hit = db
      .prepare('SELECT content FROM search_probe WHERE search_probe MATCH ?')
      .get('知识库');
    assert(hit && hit.content === '守岸人私人助理知识库', 'Electron FTS5 probe failed');
    console.log(
      JSON.stringify({
        electron: process.versions.electron,
        node: process.versions.node,
        abi: process.versions.modules,
        sqlite: db.prepare('SELECT sqlite_version() AS version').get().version,
        nativeModuleLoaded: true,
        trigramSearch: true,
      }),
    );
  } finally {
    db.close();
    removeTemporaryDirectory(temporaryDirectory);
    app.quit();
  }
}).catch((error) => {
  console.error('[native-sqlite-electron-poc] failed:', error);
  app.exit(1);
});
