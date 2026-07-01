/**
 * 重建数据库（等同全新安装），但保留 app_settings 中的 API 接入配置。
 *
 * 用法:
 *   pnpm db:reset-keep-models --yes
 *   pnpm db:reset-keep-models --yes --clear-workspace
 *
 * 请先完全退出应用再运行。
 */
import { config } from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import type { SqliteDb } from '../src/db/index.js';
import {
  getDatabaseDir,
  getDatabasePath,
  getWorkspaceDir,
  openDatabase,
} from '../src/db/index.js';
import { seedShorekeeper } from '../src/db/seed.js';
import {
  MODEL_API_KEY_SETTING,
  MODEL_BASE_URL_SETTING,
  MODEL_ID_SETTING,
  MODEL_PROFILES_KEY,
  MODEL_PROTOCOL_KEY,
} from '../src/models/config.js';

config({ path: path.join(process.cwd(), '.env') });

const args = new Set(process.argv.slice(2));
const confirmed = args.has('--yes');
const clearWorkspace = args.has('--clear-workspace');

if (!confirmed) {
  console.error('此操作将删除数据库并重建（会话、记忆、RAG 等全部清空），仅保留 API 设置。');
  console.error('请先完全退出 The Shorekeeper，然后执行:');
  console.error('  pnpm db:reset-keep-models --yes');
  console.error('可选: --clear-workspace  同时清空 Agent 工作区文件');
  process.exit(1);
}

interface PreservedModelSettings {
  profiles: unknown | null;
  protocol: string | null;
  legacyApiKey: string | null;
  legacyBaseUrl: string | null;
  legacyModelId: string | null;
}

function readPreservedSettings(db: Awaited<ReturnType<typeof openDatabase>>): PreservedModelSettings {
  const row = (key: string) =>
    db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined;

  const profilesRaw = row(MODEL_PROFILES_KEY)?.value;
  let profiles: unknown | null = null;
  if (profilesRaw) {
    try {
      profiles = JSON.parse(profilesRaw);
    } catch {
      console.warn('[reset] model.profiles JSON 无效，将不恢复多套配置');
    }
  }

  return {
    profiles,
    protocol: row(MODEL_PROTOCOL_KEY)?.value ?? null,
    legacyApiKey: row(MODEL_API_KEY_SETTING)?.value ?? null,
    legacyBaseUrl: row(MODEL_BASE_URL_SETTING)?.value ?? null,
    legacyModelId: row(MODEL_ID_SETTING)?.value ?? null,
  };
}

function upsertSetting(db: SqliteDb, key: string, value: string): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, value, now);
}

function restoreModelSettings(db: SqliteDb, preserved: PreservedModelSettings): void {
  if (preserved.profiles) {
    upsertSetting(db, MODEL_PROFILES_KEY, JSON.stringify(preserved.profiles));
    if (preserved.protocol) {
      upsertSetting(db, MODEL_PROTOCOL_KEY, preserved.protocol);
    }
    return;
  }

  if (preserved.legacyApiKey || preserved.legacyBaseUrl || preserved.legacyModelId) {
    if (preserved.legacyApiKey) upsertSetting(db, MODEL_API_KEY_SETTING, preserved.legacyApiKey);
    if (preserved.legacyBaseUrl) upsertSetting(db, MODEL_BASE_URL_SETTING, preserved.legacyBaseUrl);
    if (preserved.legacyModelId) upsertSetting(db, MODEL_ID_SETTING, preserved.legacyModelId);
    if (preserved.protocol) upsertSetting(db, MODEL_PROTOCOL_KEY, preserved.protocol);
  }
}

function backupDatabase(dbPath: string): string {
  const backupPath = `${dbPath}.bak-${Date.now()}`;
  fs.copyFileSync(dbPath, backupPath);
  return backupPath;
}

function clearWorkspaceDir(workspaceDir: string): number {
  if (!fs.existsSync(workspaceDir)) return 0;

  let removed = 0;
  for (const entry of fs.readdirSync(workspaceDir, { withFileTypes: true })) {
    const target = path.join(workspaceDir, entry.name);
    fs.rmSync(target, { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

const dbPath = getDatabasePath();
const workspaceDir = getWorkspaceDir();
let preserved: PreservedModelSettings = {
  profiles: null,
  protocol: null,
  legacyApiKey: null,
  legacyBaseUrl: null,
  legacyModelId: null,
};

if (fs.existsSync(dbPath)) {
  const oldDb = await openDatabase(dbPath);
  preserved = readPreservedSettings(oldDb);
  await oldDb.closeAsync();

  const backupPath = backupDatabase(dbPath);
  console.log('已备份旧库:', backupPath);

  fs.unlinkSync(dbPath);
  console.log('已删除:', dbPath);
} else {
  console.log('数据库不存在，将创建新库:', dbPath);
}

if (clearWorkspace) {
  const removed = clearWorkspaceDir(workspaceDir);
  console.log(`已清空工作区 (${removed} 项):`, workspaceDir);
}

const db = await openDatabase(dbPath);
const seedResult = seedShorekeeper(db);
restoreModelSettings(db, preserved);
await db.closeAsync();

const hasProfiles =
  preserved.profiles &&
  typeof preserved.profiles === 'object' &&
  'profiles' in (preserved.profiles as object) &&
  Array.isArray((preserved.profiles as { profiles: unknown[] }).profiles) &&
  (preserved.profiles as { profiles: unknown[] }).profiles.length > 0;

const hasLegacy = Boolean(
  preserved.legacyApiKey || preserved.legacyBaseUrl || preserved.legacyModelId,
);

console.log('');
console.log('数据库目录:', getDatabaseDir());
console.log('数据库文件:', dbPath);
console.log('工作区目录:', workspaceDir);
console.log('Worldbook seed: 新增', seedResult.worldbookInserted, '条, 跳过', seedResult.worldbookSkipped, '条');
if (hasProfiles) {
  const count = (preserved.profiles as { profiles: unknown[] }).profiles.length;
  console.log('API 配置: 已恢复 model.profiles（', count, '套）');
} else if (hasLegacy) {
  console.log('API 配置: 已恢复旧版单套字段 (model.api_key 等)');
} else {
  console.log('API 配置: 旧库中无应用内配置，将使用 .env 默认值');
}
console.log('完成。请启动应用验证 设置 → API 设置。');
