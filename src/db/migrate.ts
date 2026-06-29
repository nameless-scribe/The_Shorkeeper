import fs from 'node:fs';
import path from 'node:path';
import type { SqliteDb } from './index';

const MIGRATIONS_DIR = path.join(process.cwd(), 'src', 'db', 'migrations');

/** 按文件名顺序执行尚未应用的 SQL migration */
export function runMigrations(db: SqliteDb): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    return [];
  }

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && f !== '0000_init.sql')
    .sort();

  const applied: string[] = [];

  for (const file of files) {
    const row = db.prepare('SELECT name FROM schema_migrations WHERE name = ?').get(file);
    if (row) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    try {
      db.exec(sql);
    } catch (err) {
      if (file.includes('fts5')) {
        console.warn(`[migrate] 跳过 ${file}（当前 SQLite 不支持 FTS5）`);
        db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(
          file,
          Date.now(),
        );
        applied.push(`${file} (skipped)`);
        continue;
      }
      const message = err instanceof Error ? err.message : String(err);
      if (file.includes('rag') && message.includes('duplicate column')) {
        console.warn(`[migrate] ${file} 部分列已存在，跳过`);
        db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(
          file,
          Date.now(),
        );
        applied.push(`${file} (partial)`);
        continue;
      }
      if (file.includes('m7') && message.includes('duplicate column')) {
        console.warn(`[migrate] ${file} 部分列已存在，跳过`);
        db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(
          file,
          Date.now(),
        );
        applied.push(`${file} (partial)`);
        continue;
      }
      if (file.includes('token_cache') && message.includes('duplicate column')) {
        console.warn(`[migrate] ${file} 部分列已存在，跳过`);
        db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(
          file,
          Date.now(),
        );
        applied.push(`${file} (partial)`);
        continue;
      }
      throw err;
    }
    db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(
      file,
      Date.now(),
    );
    applied.push(file);
  }

  return applied;
}
