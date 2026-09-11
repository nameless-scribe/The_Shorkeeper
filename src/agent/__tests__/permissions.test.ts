import { describe, expect, it } from 'vitest';
import {
  checkFilesystemRead,
  checkPermission,
  confirmPermission,
  resolveToolPermission,
  setPermissionConfirmer,
} from '../permissions';
import path from 'node:path';
import os from 'node:os';
import type { ToolDefinition } from '../../tools/types';

describe('permissions', () => {
  const root = path.join(os.tmpdir(), 'sk-perm-workspace');
  const policy = {
    filesystem: { allowedRoots: [root], writeAllowed: true, requireConfirmOnWrite: true },
    network: true,
    mcp: false,
    automation: { allowed: true, requireConfirm: true },
    shell: { allowed: false, requireConfirm: true },
  };

  it('allows paths inside workspace', () => {
    expect(checkFilesystemRead('notes/readme.md', policy)).toBe('allow');
  });

  it('denies paths outside workspace', () => {
    expect(checkFilesystemRead('../../../Windows/System32', policy)).toBe('deny');
  });

  it('checks every filesystem path argument, including output_path', () => {
    const tool: ToolDefinition = {
      name: 'convert_to_markdown',
      description: 'test',
      category: 'doc',
      requiresPermission: ['filesystem:read', 'filesystem:write'],
      parameters: { type: 'object' },
      execute: async () => ({ success: true, output: '' }),
    };

    expect(
      checkPermission(tool, policy, {
        path: 'source.docx',
        output_path: '../../../outside.md',
      }),
    ).toBe('deny');
  });

  it('requires confirmation for automation and denies shell by default', () => {
    const automationTool: ToolDefinition = {
      name: 'create_scheduled_task',
      description: 'test',
      category: 'life',
      requiresPermission: ['automation'],
      parameters: { type: 'object' },
      execute: async () => ({ success: true, output: '' }),
    };
    const shellTool: ToolDefinition = {
      ...automationTool,
      name: 'shell',
      requiresPermission: ['shell'],
    };

    expect(checkPermission(automationTool, policy, {})).toBe('confirm');
    expect(checkPermission(shellTool, policy, {})).toBe('deny');
  });

  it('resolves confirmable permissions through the shared confirmer', async () => {
    const tool: ToolDefinition = {
      name: 'create_scheduled_task',
      description: 'test',
      category: 'life',
      requiresPermission: ['automation'],
      parameters: { type: 'object' },
      execute: async () => ({ success: true, output: '' }),
    };

    setPermissionConfirmer(async () => true);
    await expect(resolveToolPermission(tool, policy, {})).resolves.toBe('allow');
    setPermissionConfirmer(async () => false);
    await expect(resolveToolPermission(tool, policy, {})).resolves.toBe('deny');
    setPermissionConfirmer(async () => false);
  });

  it('rejects a new file below a symlink that escapes the workspace', async () => {
    const fs = await import('node:fs/promises');
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-perm-link-'));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-perm-outside-'));
    await fs.symlink(outside, path.join(workspace, 'linked'), 'junction');

    const tool: ToolDefinition = {
      name: 'write_file',
      description: 'test',
      category: 'file',
      requiresPermission: ['filesystem:write'],
      parameters: { type: 'object' },
      execute: async () => ({ success: true, output: '' }),
    };

    expect(checkPermission(tool, { ...policy, filesystem: { ...policy.filesystem, allowedRoots: [workspace] } }, {
      path: 'linked/new.txt',
    })).toBe('deny');
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
