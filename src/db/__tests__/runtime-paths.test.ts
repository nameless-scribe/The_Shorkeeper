import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { configureDbRuntime, resolveMigrationsDir, resolveSqlWasmPath } from '../runtime-paths';

afterEach(() => {
  configureDbRuntime({
    isPackaged: false,
    appPath: process.cwd(),
    resourcesPath: process.cwd(),
  });
});

describe('db runtime paths', () => {
  it('resolves dev wasm from node_modules', () => {
    const wasm = resolveSqlWasmPath('sql-wasm.wasm');
    expect(fs.existsSync(wasm)).toBe(true);
  });

  it('resolves packaged resources', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'db-runtime-'));
    const sqlDir = path.join(root, 'sql.js');
    fs.mkdirSync(sqlDir, { recursive: true });
    fs.writeFileSync(path.join(sqlDir, 'sql-wasm.wasm'), 'wasm');

    const migDir = path.join(root, 'db-migrations');
    fs.mkdirSync(migDir);
    fs.writeFileSync(path.join(migDir, '0001_test.sql'), 'SELECT 1;');

    configureDbRuntime({
      isPackaged: true,
      appPath: root,
      resourcesPath: root,
    });

    expect(resolveSqlWasmPath('sql-wasm.wasm')).toBe(path.join(sqlDir, 'sql-wasm.wasm'));
    expect(resolveMigrationsDir()).toBe(migDir);
  });
});
