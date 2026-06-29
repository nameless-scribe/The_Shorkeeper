import { describe, expect, it } from 'vitest';
import { checkFilesystemRead } from '../permissions';
import path from 'node:path';
import os from 'node:os';

describe('permissions', () => {
  const root = path.join(os.tmpdir(), 'sk-perm-workspace');
  const policy = {
    filesystem: { allowedRoots: [root], requireConfirmOnWrite: true },
    network: true,
    mcp: false,
  };

  it('allows paths inside workspace', () => {
    expect(checkFilesystemRead('notes/readme.md', policy)).toBe('allow');
  });

  it('denies paths outside workspace', () => {
    expect(checkFilesystemRead('../../../Windows/System32', policy)).toBe('deny');
  });
});
