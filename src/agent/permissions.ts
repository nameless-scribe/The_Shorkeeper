import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getWorkspaceDir } from '../config/paths';
import { isPathWithinWorkspaceRoots } from '../tools/file/workspace-path';
import { buildPermissionPolicy } from './policy-loader';
import type { PermissionDecision, PermissionPolicy } from './types';
import type { ToolDefinition, ToolRiskLevel } from '../tools/types';
import { requiresMandatoryConfirmation, resolveToolContract } from '../tools/contract';
import { isDatabaseReady } from '../db/state';
import { createApproval, decideApproval, getApproval, getTaskRunStep, stepRecordId } from '../db/repositories/task-runs';
import type { ApprovalDecider, ToolPreviewInfo } from '../shared/types';

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
  preview?: ToolPreviewInfo;
  callId?: string;
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

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableJsonValue(item)]));
  }
  return value;
}

export function digestPermissionArgs(args: unknown): string {
  return createHash('sha256').update(JSON.stringify(stableJsonValue(args ?? null)) ?? 'null').digest('hex');
}

export interface PermissionApprovalReceipt {
  approved: boolean;
  approvalId: string;
  argsDigest: string;
  previewRevision: string | null;
}

async function confirmPermissionInternal(
  toolName: string,
  args: unknown,
  signal: AbortSignal | undefined,
  context: PermissionConfirmContext | undefined,
  requirePersistent: boolean,
): Promise<{ approved: boolean; receipt?: PermissionApprovalReceipt }> {
  const argsDigest = digestPermissionArgs(args);
  const previewRevision = context?.preview?.revision ?? null;
  if (requirePersistent) {
    if (!isDatabaseReady()) throw new Error('无法可靠记录本次审批，已停止执行');
    if (!context?.runId || !context.sessionId || !context.callId) throw new Error('本次调用缺少可验证的审批绑定，已停止执行');
    const step = getTaskRunStep(stepRecordId(context.runId, context.callId));
    if (!step || step.runId !== context.runId || step.callId !== context.callId || step.toolName !== toolName || step.status !== 'running') {
      throw new Error('本次工具步骤尚未可靠记录，已停止执行');
    }
  }

  let approvalId: string | null = null;
  if (isDatabaseReady()) {
    try {
      approvalId = createApproval({
        runId: context?.runId ?? null,
        sessionId: context?.sessionId ?? null,
        toolName,
        args,
        argsDigest,
        previewRevision,
        callId: context?.callId ?? null,
        riskLevel: context?.risk ?? 'medium',
      }).id;
    } catch (error) {
      if (requirePersistent) throw new Error(`审批记录写入失败，已停止执行：${error instanceof Error ? error.message : String(error)}`);
      console.warn('[permissions] 审批记录写入失败:', error instanceof Error ? error.message : error);
    }
  }

  let outcome: Required<PermissionConfirmOutcome>;
  try {
    outcome = normalizeOutcome(await permissionConfirmer(toolName, args, signal, context), signal);
  } catch (error) {
    if (approvalId) {
      try {
        decideApproval(approvalId, signal?.aborted ? 'cancelled' : 'denied', signal?.aborted ? 'abort' : 'error');
      } catch (decisionError) {
        if (requirePersistent) throw new Error(`审批流程失败且无法可靠收口：${decisionError instanceof Error ? decisionError.message : String(decisionError)}`);
      }
    }
    throw error;
  }

  if (approvalId) {
    try {
      decideApproval(approvalId, approvalStatusFor(outcome), outcome.decidedBy);
    } catch (error) {
      if (requirePersistent) throw new Error(`审批结论写入失败，已停止执行：${error instanceof Error ? error.message : String(error)}`);
      console.warn('[permissions] 审批结论写入失败:', error instanceof Error ? error.message : error);
    }
  }

  if (!requirePersistent) return { approved: outcome.approved };
  const stored = approvalId ? getApproval(approvalId) : null;
  if (!stored
      || stored.status !== approvalStatusFor(outcome)
      || stored.runId !== context!.runId
      || stored.sessionId !== context!.sessionId
      || stored.callId !== context!.callId
      || stored.toolName !== toolName
      || stored.argsDigest !== argsDigest
      || stored.previewRevision !== previewRevision) {
    throw new Error('审批记录读回校验失败，已停止执行');
  }
  return {
    approved: outcome.approved,
    receipt: outcome.approved ? { approved: true, approvalId: stored.id, argsDigest, previewRevision } : undefined,
  };
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
  return (await confirmPermissionInternal(toolName, args, signal, context, false)).approved;
}

/** 高风险外部写入专用：审批及其调用绑定无法可靠持久化时 fail closed。 */
export async function confirmPermissionStrict(
  toolName: string,
  args: unknown,
  signal?: AbortSignal,
  context?: PermissionConfirmContext,
): Promise<PermissionApprovalReceipt | null> {
  const result = await confirmPermissionInternal(toolName, args, signal, context, true);
  return result.approved ? result.receipt ?? null : null;
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
