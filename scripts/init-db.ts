import { openDatabase, getDatabasePath, getDatabaseDir, getWorkspaceDir } from '../src/db/index.js';

const db = await openDatabase();
const version = db.prepare('SELECT sqlite_version() AS version').get();
await db.closeAsync();

console.log('数据库目录:', getDatabaseDir());
console.log('数据库文件:', getDatabasePath());
console.log('工作区目录:', getWorkspaceDir());
console.log('SQLite 版本:', version?.version);
console.log('初始化完成。');
