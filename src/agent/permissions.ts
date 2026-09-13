import fs from 'node:fs';
import path from 'node:path';
import { getWorkspaceDir } from '../config/paths';
import { isPathWithinWorkspaceRoots } from '../tools/file/workspace-path';
import { buildPermissionPolicy } from './policy-loader';
import type { PermissionDecision, PermissionPolicy } from './types';
import type { ToolDefinition, ToolRiskLevel } from '../tools/types';
import { requiresMandatoryConfirmation, resolveToolContract } from '../tools/contract';
import { isDatabaseReady } from '../db/state';
import { createApproval, decideApproval } from '../db/repositories/task-runs';
import type { ApprovalDecider } from '../shared/types';

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

function checkPolicyPermission(
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

/**
 * 权限策略决定 allow/deny/confirm；工具契约中的高风险等级会把 allow 提升为 confirm，
 * 保证发送、购买、删除类动作永远经过用户。
 */
export function checkPermission(
  tool: ToolDefinition,
  policy: PermissionPolicy,
  args?: unknown,
): PermissionDecision {
  const decision = checkPolicyPermission(tool, policy, args);
  if (decision === 'allow' && requiresMandatoryConfirmation(resolveToolContract(tool))) {
    return 'confirm';
  }
  return decision;
}

export interface PermissionConfirmContext {
  runId?: string;
  sessionId?: string;
  risk?: ToolRiskLevel;
}

export interface PermissionConfirmOutcome {
  approved: boolean;
  decidedBy?: ApprovalDecider;
}

type PermissionConfirmer = (
  toolName: string,
  args: unknown,
  signal?: AbortSignal,
  context?: PermissionConfirmContext,
) => Promise<boolean | PermissionConfirmOutcome>;

let permissionConfirmer: PermissionConfirmer = async () => false;

export function setPermissionConfirmer(confirmer: PermissionConfirmer): void {
  permissionConfirmer = confirmer;
}

function normalizeOutcome(
  raw: boolean | PermissionConfirmOutcome,
  signal?: AbortSignal,
): Required<PermissionConfirmOutcome> {
  if (typeof raw === 'boolean') {
    return {
      approved: raw,
      decidedBy: raw ? 'user' : signal?.aborted ? 'abort' : 'user',
    };
  }
  return {
    approved: raw.approved,
    decidedBy: raw.decidedBy ?? (raw.approved ? 'user' : signal?.aborted ? 'abort' : 'user'),
  };
}

function approvalStatusFor(outcome: Required<PermissionConfirmOutcome>): 'approved' | 'denied' | 'expired' | 'cancelled' {
  if (outcome.approved) return 'approved';
  if (outcome.decidedBy === 'timeout') return 'expired';
  if (outcome.decidedBy === 'abort' || outcome.decidedBy === 'window_closed') return 'cancelled';
  return 'denied';
}

/**
 * 请求用户确认，并把审批请求和结论持久化到 approvals 表。
 * 数据库不可用时仍然完成确认，只是不留记录。
 */
export async function confirmPermission(
  toolName: string,
  args: unknown,
  signal?: AbortSignal,
  context?: PermissionConfirmContext,
): Promise<boolean> {
  let approvalId: string | null = null;
  if (isDatabaseReady()) {
    try {
      approvalId = createApproval({
        runId: context?.runId ?? null,
        sessionId: context?.sessionId ?? null,
        toolName,
        args,
        riskLevel: context?.risk ?? 'medium',
      }).id;
    } catch (error) {
      console.warn('[permissions] 审批记录写入失败:', error instanceof Error ? error.message : error);
    }
  }

  let outcome: Required<PermissionConfirmOutcome>;
  try {
    outcome = normalizeOutcome(await permissionConfirmer(toolName, args, signal, context), signal);
  } catch (error) {
    if (approvalId) {
      try {
        // 确认流程自身出错时用户并未做出选择，记录为 error 而不是用户拒绝。
        decideApproval(approvalId, signal?.aborted ? 'cancelled' : 'denied', signal?.aborted ? 'abort' : 'error');
      } catch {
        // 审批记录只是证据，不能反过来阻断确认流程。
      }
    }
    throw error;
  }

  if (approvalId) {
    try {
      decideApproval(approvalId, approvalStatusFor(outcome), outcome.decidedBy);
    } catch (error) {
      console.warn('[permissions] 审批结论写入失败:', error instanceof Error ? error.message : error);
    }
  }
  return outcome.approved;
}

/** Resolve a tool's permission for callers that execute tools outside the main loop. */
export async function resolveToolPermission(
  tool: ToolDefinition,
  policy: PermissionPolicy,
  args: unknown,
  signal?: AbortSignal,
  context?: Omit<PermissionConfirmContext, 'risk'>,
): Promise<PermissionDecision> {
  const decision = checkPermission(tool, policy, args);
  if (decision !== 'confirm') return decision;
  const approved = await confirmPermission(tool.name, args, signal, {
    ...context,
    risk: resolveToolContract(tool).risk,
  });
  return approved ? 'allow' : 'deny';
}
