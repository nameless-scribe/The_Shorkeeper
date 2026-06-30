import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bootstrapDataLayout } from '../bootstrap-data-layout';

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'shorekeeper-bootstrap-'));
}

afterEach(() => {
  delete process.env.SHOREKEEPER_DB_DIR;
  delete process.env.SHOREKEEPER_DB_PATH;
  delete process.env.SHOREKEEPER_WORKSPACE_DIR;
});

describe('bootstrapDataLayout', () => {
  it('creates workspace and seeds readme', () => {
    const root = path.join(tempRoot(), 'data');
    process.env.SHOREKEEPER_DB_DIR = root;

    const result = bootstrapDataLayout(path.join(tempRoot(), 'fallback'));

    expect(result.usedFallback).toBe(false);
    expect(fs.existsSync(path.join(root, 'workspace', 'README.txt'))).toBe(true);
    expect(fs.existsSync(path.dirname(result.databasePath))).toBe(true);
  });

  it('falls back when primary root is not writable', () => {
    const fallback = tempRoot();
    const blocker = path.join(tempRoot(), 'blocked-file');
    fs.writeFileSync(blocker, 'x');
    const badRoot = path.join(blocker, 'inner');

    const result = bootstrapDataLayout(fallback, { primaryRoot: badRoot });

    expect(result.usedFallback).toBe(true);
    expect(result.databaseDir).toBe(path.join(fallback, 'data'));
    expect(fs.existsSync(path.join(result.workspaceDir, 'README.txt'))).toBe(true);
  });
});
