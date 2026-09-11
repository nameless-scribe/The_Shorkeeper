import fs from 'node:fs';
import path from 'node:path';
import { getWorkspaceDir } from '../config/paths';
import { isPathWithinWorkspaceRoots } from '../tools/file/workspace-path';
import { buildPermissionPolicy } from './policy-loader';
import type { PermissionDecision, PermissionPolicy } from './types';
import type { ToolDefinition } from '../tools/types';

export function ensureWorkspaceDir(): string {
  const root = path.resolve(getWorkspaceDir());
  fs.mkdirSync(root, { recursive: true });
  return root;
}

export function defaultPermissionPolicy(): PermissionPolicy {
  return buildPermissionPolicy();
}

export function checkFilesystemRead(
  filePath: string,
  policy: PermissionPolicy,
): PermissionDecision {
  return isPathWithinWorkspaceRoots(filePath, policy.filesystem.allowedRoots)
    ? 'allow'
    : 'deny';
}

const PATH_ARGUMENT_KEYS = [
  'path',
  'output_path',
  'source_path',
  'file_path',
  'sourceFile',
  'relativePath',
] as const;

function extractFilesystemPaths(args: unknown): string[] {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return ['.'];

  const record = args as Record<string, unknown>;
  const paths = PATH_ARGUMENT_KEYS
    .map((key) => record[key])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  return paths.length > 0 ? paths : ['.'];
}

export function checkPermission(
  tool: ToolDefinition,
  policy: PermissionPolicy,
  args?: unknown,
): PermissionDecision {
  for (const flag of tool.requiresPermission) {
    if (flag === 'filesystem:read') {
      if (extractFilesystemPaths(args).some((filePath) => checkFilesystemRead(filePath, policy) === 'deny')) {
        return 'deny';
      }
    }

    if (flag === 'filesystem:write') {
      if (!policy.filesystem.writeAllowed) return 'deny';
      if (extractFilesystemPaths(args).some((filePath) => checkFilesystemRead(filePath, policy) === 'deny')) {
        return 'deny';
      }
      if (policy.filesystem.requireConfirmOnWrite) return 'confirm';
    }

    if (flag === 'network' && !policy.network) return 'deny';
    if (flag === 'mcp' && !policy.mcp) return 'deny';
    if (flag === 'automation') {
      if (!policy.automation?.allowed) return 'deny';
      if (policy.automation.requireConfirm) return 'confirm';
    }
    if (flag === 'shell') {
      if (!policy.shell?.allowed) return 'deny';
      if (policy.shell.requireConfirm) return 'confirm';
    }
  }

  return 'allow';
}

type PermissionConfirmer = (
  toolName: string,
  args: unknown,
  signal?: AbortSignal,
) => Promise<boolean>;

let permissionConfirmer: PermissionConfirmer = async () => false;

export function setPermissionConfirmer(confirmer: PermissionConfirmer): void {
  permissionConfirmer = confirmer;
}

export async function confirmPermission(
  toolName: string,
  args: unknown,
  signal?: AbortSignal,
): Promise<boolean> {
  return permissionConfirmer(toolName, args, signal);
}

/** Resolve a tool's permission for callers that execute tools outside the main loop. */
export async function resolveToolPermission(
  tool: ToolDefinition,
  policy: PermissionPolicy,
  args: unknown,
  signal?: AbortSignal,
): Promise<PermissionDecision> {
  const decision = checkPermission(tool, policy, args);
  if (decision !== 'confirm') return decision;
  return (await confirmPermission(tool.name, args, signal)) ? 'allow' : 'deny';
}
