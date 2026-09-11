import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabaseAsync, openDatabase } from '../index';
import {
  getDatabaseEngineMarkerPath,
  getNativeDatabasePath,
  resolveDatabaseRuntime,
} from '../engine-state';
import {
  cutoverToNativeDatabase,
  rollbackNativeDatabase,
} from '../native-migration';
import { inspectNativeDatabaseHealth } from '../health-native';

describe('database engine state and native cutover', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shorekeeper-engine-state-'));
    dbPath = path.join(tempDir, 'shorekeeper.db');
  });

  afterEach(async () => {
    await closeDatabaseAsync();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('cuts over to native, boots through the marker, and rolls back to sql.js', async () => {
    const source = await openDatabase(dbPath);
    source.prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)').run(
      'engine.test',
      'source',
      Date.now(),
    );
    await source.closeAsync();

    const result = await cutoverToNativeDatabase(dbPath);
    expect(fs.existsSync(result.nativePath)).toBe(true);
    expect(fs.existsSync(result.markerPath)).toBe(true);
    expect(resolveDatabaseRuntime(dbPath).engine).toBe('better-sqlite3');
    expect(inspectNativeDatabaseHealth(result.nativePath).integrity.ok).toBe(true);

    const native = await import('../index').then(({ initDatabase }) => initDatabase(dbPath));
    expect(native.prepare('SELECT value FROM app_settings WHERE key = ?').get('engine.test')?.value)
      .toBe('source');
    await native.closeAsync();
    await closeDatabaseAsync();

    const rollback = await rollbackNativeDatabase(dbPath);
    expect(fs.existsSync(rollback.nativeSafetyBackupPath)).toBe(true);
    expect(fs.existsSync(getDatabaseEngineMarkerPath(dbPath))).toBe(false);
    expect(resolveDatabaseRuntime(dbPath).engine).toBe('sql.js');
    expect(fs.existsSync(getNativeDatabasePath(dbPath))).toBe(true);
  });

  it('blocks startup when the engine marker is malformed', () => {
    fs.writeFileSync(getDatabaseEngineMarkerPath(dbPath), '{invalid');
    expect(() => resolveDatabaseRuntime(dbPath)).toThrow('不是有效 JSON');
  });
});
