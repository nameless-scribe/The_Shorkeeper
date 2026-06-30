import { config } from 'dotenv';
import path from 'node:path';
import { initDatabase, closeDatabase, getDatabasePath } from '../src/db/index.js';
import { getSetting } from '../src/db/app-settings.js';
import { deleteEmptySessions, listSessions } from '../src/db/repositories/sessions.js';
import { ACTIVE_SESSION_KEY } from '../src/session/active.js';

config({ path: path.join(process.cwd(), '.env') });

await initDatabase();
const before = listSessions({ limit: 1000 });
const keepId = getSetting(ACTIVE_SESSION_KEY);
const result = deleteEmptySessions({ keepSessionId: keepId });
const after = listSessions({ limit: 1000 });
closeDatabase();

console.log('数据库:', getDatabasePath());
console.log(`清理前: ${before.total} 条会话`);
console.log(`已删除: ${result.deletedCount} 条空会话`);
console.log(`清理后: ${after.total} 条会话`);
if (result.keptSessionId) {
  console.log('保留当前会话:', result.keptSessionId);
}
