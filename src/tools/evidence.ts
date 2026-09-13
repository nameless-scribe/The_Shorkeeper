import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { resolveWorkspacePath } from './file/workspace-path';
import { createToolError } from './result';
import type { ToolResult, ToolSideEffectContract } from './types';
import type { WorkspaceAttachment } from '../shared/types';

async function digestFile(filePath: string): Promise<string> {
  const contents = await fs.readFile(filePath);
  return createHash('sha256').update(contents).digest('hex');
}

export interface EvidenceCheck {
  ok: boolean;
  reason?: string;
  checkedArtifacts: number;
}

/**
 * 读回校验产物：文件必须存在于工作区、大小一致，且（若工具提供）内容摘要一致。
 * 这是闭环里的 "验证" 步骤，确保 "已完成" 的说法背后有真实文件。
 */
export interface EvidenceCheckOptions {
  /**
   * 是否重新计算内容摘要。原子写入路径已经在落盘后读回校验过摘要，
   * 主循环默认只做存在性和大小检查，避免大文件被三次哈希拖进工具超时。
   */
  verifyDigest?: boolean;
}

export async function checkArtifactEvidence(
  artifacts: WorkspaceAttachment[] | undefined,
  workspaceRoot: string,
  options: EvidenceCheckOptions = {},
): Promise<EvidenceCheck> {
  if (!artifacts?.length) {
    return { ok: false, reason: '工具声明会产生文件产物，但结果中没有任何产物', checkedArtifacts: 0 };
  }

  for (const artifact of artifacts) {
    let absolute: string;
    try {
      absolute = resolveWorkspacePath(workspaceRoot, artifact.relativePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, reason: `产物路径无效: ${artifact.relativePath}（${message}）`, checkedArtifacts: 0 };
    }

    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(absolute);
    } catch {
      return { ok: false, reason: `产物不存在: ${artifact.relativePath}`, checkedArtifacts: 0 };
    }
    if (!stat.isFile()) {
      return { ok: false, reason: `产物不是普通文件: ${artifact.relativePath}`, checkedArtifacts: 0 };
    }
    if (Number.isFinite(artifact.size) && stat.size !== artifact.size) {
      return {
        ok: false,
        reason: `产物大小不一致: ${artifact.relativePath}（记录 ${artifact.size}，实际 ${stat.size}）`,
        checkedArtifacts: 0,
      };
    }
    if (options.verifyDigest && artifact.sha256 && (await digestFile(absolute)) !== artifact.sha256) {
      return { ok: false, reason: `产物内容摘要不一致: ${artifact.relativePath}`, checkedArtifacts: 0 };
    }
  }

  return { ok: true, checkedArtifacts: artifacts.length };
}

/**
 * 成功结果若缺少契约要求的产物证据，则降级为失败，避免模型把 "声称完成" 当成完成。
 */
export async function enforceToolEvidence(
  result: ToolResult,
  contract: ToolSideEffectContract,
  workspaceRoot: string,
  options: EvidenceCheckOptions = {},
): Promise<ToolResult> {
  if (!result.success || contract.evidence !== 'artifact') return result;

  const check = await checkArtifactEvidence(result.artifacts, workspaceRoot, options);
  if (check.ok) {
    return {
      ...result,
      metadata: { ...result.metadata, evidenceVerified: true, evidenceArtifacts: check.checkedArtifacts },
    };
  }
  return createToolError(
    `完成证据校验失败：${check.reason ?? '未知原因'}`,
    'internal_error',
    { ...result.metadata, evidenceVerified: false },
  );
}
