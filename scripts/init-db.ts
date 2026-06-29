import { openDatabase, DATABASE_PATH, DATABASE_DIR, WORKSPACE_DIR } from '../src/db/index.js';

const db = await openDatabase();
const version = db.prepare('SELECT sqlite_version() AS version').get();
db.close();

console.log('数据库目录:', DATABASE_DIR);
console.log('数据库文件:', DATABASE_PATH);
console.log('工作区目录:', WORKSPACE_DIR);
console.log('SQLite 版本:', version?.version);
console.log('初始化完成。');
