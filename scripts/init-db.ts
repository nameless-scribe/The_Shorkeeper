import { initDatabase, getDatabasePath, getDatabaseDir, getWorkspaceDir } from '../src/db/index.js';
import { resolveDatabaseRuntime } from '../src/db/engine-state.js';

const db = await initDatabase();
const version = db.prepare('SELECT sqlite_version() AS version').get();
await db.closeAsync();

const runtime = resolveDatabaseRuntime(getDatabasePath());
console.log('数据库目录:', getDatabaseDir());
console.log('数据库文件:', runtime.databasePath);
console.log('数据库引擎:', runtime.engine);
console.log('工作区目录:', getWorkspaceDir());
console.log('SQLite 版本:', version?.version);
console.log('初始化完成。');
