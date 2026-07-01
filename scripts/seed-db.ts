import { openDatabase, getDatabasePath } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedShorekeeper } from '../src/db/seed.js';
import { SHOREKEEPER_WORLDBOOK } from '../src/db/seeds/index.js';

const db = await openDatabase();
const applied = runMigrations(db);
const result = seedShorekeeper(db);
await db.closeAsync();

console.log('数据库:', getDatabasePath());
if (applied.length) {
  console.log('已应用 migration:', applied.join(', '));
} else {
  console.log('Migration: 无新增');
}
console.log('人设 seed: 已写入 app_settings (persona.system_prompt, persona.version)');
console.log(
  `Worldbook seed: 新增 ${result.worldbookInserted} 条, 跳过 ${result.worldbookSkipped} 条 (共 ${SHOREKEEPER_WORLDBOOK.length} 条定义)`,
);
console.log('完成。');
