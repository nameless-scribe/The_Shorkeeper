import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteDb } from '../index';
import { ensurePersonaUpToDate } from '../seed';
import {
  PERSONA_CUSTOM_VERSION,
  PERSONA_SETTING_KEYS,
  SHOREKEEPER_PERSONA,
} from '../seeds/persona-shorekeeper';

const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js/dist/sql-wasm.js') as (
  config?: { locateFile?: (file: string) => string },
) => Promise<import('sql.js').SqlJsStatic>;

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

function getSetting(db: SqliteDb, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

function setSetting(db: SqliteDb, key: string, value: string): void {
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, value, Date.now());
}

describe('ensurePersonaUpToDate', () => {
  let db: SqliteDb;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-seed-'));
    const SQL = await initSqlJs({
      locateFile: (file) =>
        path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file),
    });
    const raw = new SQL.Database();
    db = new SqliteDb(SQL, raw, path.join(tmpDir, 'test.db'));
    db.exec(INIT_SQL);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes builtin when no version and no prompt', () => {
    const updated = ensurePersonaUpToDate(db);
    expect(updated).toBe(true);
    expect(getSetting(db, PERSONA_SETTING_KEYS.version)).toBe(SHOREKEEPER_PERSONA.version);
    expect(getSetting(db, PERSONA_SETTING_KEYS.systemPrompt)).toBe(SHOREKEEPER_PERSONA.systemPrompt);
  });

  it('does not overwrite when version is custom', () => {
    setSetting(db, PERSONA_SETTING_KEYS.version, PERSONA_CUSTOM_VERSION);
    setSetting(db, PERSONA_SETTING_KEYS.systemPrompt, '自定义人设');

    expect(ensurePersonaUpToDate(db)).toBe(false);
    expect(getSetting(db, PERSONA_SETTING_KEYS.systemPrompt)).toBe('自定义人设');
  });

  it('does not overwrite when version matches builtin', () => {
    setSetting(db, PERSONA_SETTING_KEYS.version, SHOREKEEPER_PERSONA.version);
    setSetting(db, PERSONA_SETTING_KEYS.systemPrompt, SHOREKEEPER_PERSONA.systemPrompt);

    expect(ensurePersonaUpToDate(db)).toBe(false);
  });

  it('does not overwrite when version missing but prompt exists', () => {
    setSetting(db, PERSONA_SETTING_KEYS.systemPrompt, '手改 DB 的人设');

    expect(ensurePersonaUpToDate(db)).toBe(false);
    expect(getSetting(db, PERSONA_SETTING_KEYS.systemPrompt)).toBe('手改 DB 的人设');
  });

  it('upgrades old shorekeeper version', () => {
    setSetting(db, PERSONA_SETTING_KEYS.version, 'shorekeeper-v1');
    setSetting(db, PERSONA_SETTING_KEYS.systemPrompt, '旧版 prompt');

    expect(ensurePersonaUpToDate(db)).toBe(true);
    expect(getSetting(db, PERSONA_SETTING_KEYS.version)).toBe(SHOREKEEPER_PERSONA.version);
    expect(getSetting(db, PERSONA_SETTING_KEYS.systemPrompt)).toBe(SHOREKEEPER_PERSONA.systemPrompt);
  });
});
