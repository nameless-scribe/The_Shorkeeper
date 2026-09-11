import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  WORKSPACE_IMPORT_EXTENSIONS,
  workspaceFileToolHint,
} from '../allowed-extensions';
import { importFileToWorkspace } from '../import';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

let tempDir: string;
let workspaceDir: string;
let sourceDir: string;

beforeEach(async () => {
  tempDir = path.join(os.tmpdir(), `sk-import-test-${Date.now()}-${Math.random()}`);
  workspaceDir = path.join(tempDir, 'workspace');
  sourceDir = path.join(tempDir, 'sources');
  await fs.mkdir(workspaceDir, { recursive: true });
  await fs.mkdir(sourceDir, { recursive: true });
  process.env.SHOREKEEPER_WORKSPACE_DIR = workspaceDir;
});

afterEach(async () => {
  delete process.env.SHOREKEEPER_WORKSPACE_DIR;
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

describe('workspace import extensions', () => {
  it('allows office formats', () => {
    expect(WORKSPACE_IMPORT_EXTENSIONS.has('.docx')).toBe(true);
    expect(WORKSPACE_IMPORT_EXTENSIONS.has('.xlsx')).toBe(true);
  });

  it('imports xlsx into workspace', async () => {
    const source = path.join(sourceDir, 'sample.xlsx');
    await fs.writeFile(source, 'fake-xlsx', 'utf-8');

    const result = await importFileToWorkspace(source);
    expect(result.originalName).toBe('sample.xlsx');
    expect(result.relativePath).toBe('sample.xlsx');
    expect(workspaceFileToolHint('.xlsx')).toBe('read_xlsx');
    await expect(fs.readFile(source, 'utf-8')).resolves.toBe('fake-xlsx');
  });

  it('renames duplicate imports with _N suffix', async () => {
    const source = path.join(sourceDir, 'sample.xlsx');
    await fs.writeFile(source, 'fake-xlsx', 'utf-8');

    const first = await importFileToWorkspace(source);
    expect(first.relativePath).toBe('sample.xlsx');

    const second = await importFileToWorkspace(source);
    expect(second.relativePath).toBe('sample_1.xlsx');
    expect(second.originalName).toBe('sample.xlsx');
  });
});
