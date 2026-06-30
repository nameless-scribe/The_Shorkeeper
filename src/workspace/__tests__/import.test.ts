import { describe, expect, it } from 'vitest';
import {
  WORKSPACE_IMPORT_EXTENSIONS,
  workspaceFileToolHint,
} from '../allowed-extensions';
import { importFileToWorkspace } from '../import';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('workspace import extensions', () => {
  it('allows office formats', () => {
    expect(WORKSPACE_IMPORT_EXTENSIONS.has('.docx')).toBe(true);
    expect(WORKSPACE_IMPORT_EXTENSIONS.has('.xlsx')).toBe(true);
  });

  it('imports xlsx into workspace', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-import-'));
    const source = path.join(tmp, 'sample.xlsx');
    await fs.writeFile(source, 'fake-xlsx', 'utf-8');

    const result = await importFileToWorkspace(source);
    expect(result.originalName).toBe('sample.xlsx');
    expect(result.relativePath).toBe('sample.xlsx');
    expect(workspaceFileToolHint('.xlsx')).toBe('read_xlsx');
  });
});
