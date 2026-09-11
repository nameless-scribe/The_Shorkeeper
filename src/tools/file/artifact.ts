import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { WorkspaceAttachment } from '../../shared/types';
import type { ToolResult } from '../types';
import { resolveWorkspacePath } from './workspace-path';

export async function buildFileArtifact(
  workspaceRoot: string,
  relativePath: string,
): Promise<WorkspaceAttachment> {
  const absolute = resolveWorkspacePath(workspaceRoot, relativePath);
  const stat = await fs.stat(absolute);
  return {
    relativePath: relativePath.replace(/\\/g, '/'),
    originalName: path.basename(relativePath),
    size: stat.size,
  };
}

export function withFileArtifact(
  result: ToolResult,
  artifact: WorkspaceAttachment,
): ToolResult {
  return { ...result, artifacts: [artifact] };
}

/**
 * Write a workspace file through a temporary sibling and recover the previous
 * file if validation or replacement fails. The writer may produce text,
 * binary, DOCX, XLSX or PDF content.
 */
export async function writeWorkspaceFileAtomically(
  workspaceRoot: string,
  relativePath: string,
  writer: (temporaryPath: string) => Promise<void>,
): Promise<WorkspaceAttachment> {
  const absolute = resolveWorkspacePath(workspaceRoot, relativePath);
  const directory = path.dirname(absolute);
  const basename = path.basename(absolute);
  // Keep the original extension: libraries such as ExcelJS select their
  // serializer from the destination suffix.
  const extension = path.extname(basename) || '.tmp';
  const temporaryPath = path.join(directory, `.${basename}.shorekeeper-${randomUUID()}${extension}`);
  const backupPath = path.join(directory, `.${basename}.shorekeeper-${randomUUID()}.bak`);
  let backupCreated = false;
  let committed = false;

  try {
    await fs.mkdir(directory, { recursive: true });
    await writer(temporaryPath);

    const temporaryStat = await fs.stat(temporaryPath);
    if (!temporaryStat.isFile()) {
      throw new Error('生成结果不是普通文件');
    }

    try {
      await fs.rename(absolute, backupPath);
      backupCreated = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    await fs.rename(temporaryPath, absolute);
    committed = true;
    const artifact = await buildFileArtifact(workspaceRoot, relativePath);

    if (artifact.size !== temporaryStat.size) {
      throw new Error('生成文件校验失败：文件大小发生变化');
    }
    if (backupCreated) await fs.rm(backupPath, { force: true });
    return artifact;
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    if (committed) {
      await fs.rm(absolute, { force: true }).catch(() => undefined);
    }
    if (backupCreated) {
      try {
        await fs.rename(backupPath, absolute);
      } catch (restoreError) {
        throw new AggregateError(
          [error, restoreError],
          '文件写入失败，且旧文件自动恢复失败；恢复备份已保留',
        );
      }
    }
    throw error;
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}
