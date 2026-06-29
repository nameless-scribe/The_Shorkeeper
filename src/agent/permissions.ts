import fs from 'node:fs';
import path from 'node:path';
import { dialog } from 'electron';
import { WORKSPACE_DIR } from '../config/paths';
import { buildPermissionPolicy } from './policy-loader';
import type { PermissionDecision, PermissionPolicy } from './types';
import type { ToolDefinition } from '../tools/types';

export function ensureWorkspaceDir(): string {
  const root = path.resolve(WORKSPACE_DIR);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

export function defaultPermissionPolicy(): PermissionPolicy {
  return buildPermissionPolicy();
}

function isPathWithinRoots(targetPath: string, roots: string[]): boolean {
  const resolved = path.resolve(targetPath);
  return roots.some((root) => {
    const normalizedRoot = path.resolve(root);
    return (
      resolved === normalizedRoot ||
      resolved.startsWith(normalizedRoot + path.sep)
    );
  });
}

export function checkFilesystemRead(
  filePath: string,
  policy: PermissionPolicy,
): PermissionDecision {
  for (const root of policy.filesystem.allowedRoots) {
    try {
      const resolved = path.resolve(root, filePath);
      if (isPathWithinRoots(resolved, policy.filesystem.allowedRoots)) {
        return 'allow';
      }
    } catch {
      continue;
    }
  }
  return 'deny';
}

export function checkPermission(
  tool: ToolDefinition,
  policy: PermissionPolicy,
  args?: unknown,
): PermissionDecision {
  for (const flag of tool.requiresPermission) {
    if (flag === 'filesystem:read') {
      const filePath =
        args && typeof args === 'object' && 'path' in args
          ? String((args as { path?: string }).path ?? '.')
          : '.';
      const decision = checkFilesystemRead(filePath, policy);
      if (decision === 'deny') return 'deny';
    }

    if (flag === 'filesystem:write') {
      if (!policy.filesystem.writeAllowed) return 'deny';
      if (policy.filesystem.requireConfirmOnWrite) return 'confirm';
    }

    if (flag === 'network' && !policy.network) return 'deny';
    if (flag === 'mcp' && !policy.mcp) return 'deny';
  }

  return 'allow';
}

export async function confirmPermission(
  toolName: string,
  detail: string,
): Promise<boolean> {
  const result = await dialog.showMessageBox({
    type: 'question',
    buttons: ['允许', '拒绝'],
    defaultId: 1,
    cancelId: 1,
    title: '工具权限确认',
    message: `允许执行工具「${toolName}」？`,
    detail,
  });
  return result.response === 0;
}
