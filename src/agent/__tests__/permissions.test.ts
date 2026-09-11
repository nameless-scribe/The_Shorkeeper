import { describe, expect, it } from 'vitest';
import { checkFilesystemRead, confirmPermission, setPermissionConfirmer } from '../permissions';
import path from 'node:path';
import os from 'node:os';

describe('permissions', () => {
  const root = path.join(os.tmpdir(), 'sk-perm-workspace');
  const policy = {
    filesystem: { allowedRoots: [root], writeAllowed: true, requireConfirmOnWrite: true },
    network: true,
    mcp: false,
  };

  it('allows paths inside workspace', () => {
    expect(checkFilesystemRead('notes/readme.md', policy)).toBe('allow');
  });

  it('denies paths outside workspace', () => {
    expect(checkFilesystemRead('../../../Windows/System32', policy)).toBe('deny');
  });

  it('passes the run abort signal into permission confirmation', async () => {
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    setPermissionConfirmer(async (_toolName, _args, signal) => {
      received = signal;
      return false;
    });

    await confirmPermission('write_file', { path: 'notes.md' }, controller.signal);

    expect(received).toBe(controller.signal);
    setPermissionConfirmer(async () => false);
  });
});
