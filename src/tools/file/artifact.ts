import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { WorkspaceAttachment } from '../../shared/types';
import type { ToolResult } from '../types';
import { resolveWorkspacePath } from './workspace-path';
import { isImportantWorkspacePath, workspaceBackupPath } from '../../workspace/rules';
import { getWorkspaceFileRevision } from './preview';

export async function buildFileArtifact(
  workspaceRoot: string,
  relativePath: string,
  options?: { sha256?: string },
): Promise<WorkspaceAttachment> {
  const absolute = resolveWorkspacePath(workspaceRoot, relativePath);
  const stat = await fs.stat(absolute);
  return {
    relativePath: relativePath.replace(/\\/g, '/'),
    originalName: path.basename(relativePath),
    size: stat.size,
    sha256: options?.sha256 ?? (await fileDigest(absolute)),
  };
}

export function withFileArtifact(
  result: ToolResult,
  artifact: WorkspaceAttachment,
): ToolResult {
  return { ...result, artifacts: [artifact] };
}

async function fileDigest(filePath: string): Promise<string> {
  const contents = await fs.readFile(filePath);
  return createHash('sha256').update(contents).digest('hex');
}

export interface AtomicWriteOptions {
  /** Retain a durable copy under .shorekeeper-backups before replacing the file. */
  preserveBackup?: boolean;
  /** Preview-time revision; rechecked under the target lock immediately before replacement. */
  expectedRevision?: string;
  /** Cancellation is checked at generation and commit boundaries so observed aborts roll back the target. */
  signal?: AbortSignal;
}

export class WorkspaceWriteCancelledError extends Error {
  constructor(readonly relativePath: string) {
    super(`已取消写入：${relativePath}`);
    this.name = 'WorkspaceWriteCancelledError';
  }
}

function throwIfWriteCancelled(signal: AbortSignal | undefined, relativePath: string): void {
  if (signal?.aborted) throw new WorkspaceWriteCancelledError(relativePath);
}

export class StaleWorkspaceRevisionError extends Error {
  constructor(readonly relativePath: string) {
    super(`预览已过期：${relativePath} 在确认期间发生了变化，请重新发起操作`);
    this.name = 'StaleWorkspaceRevisionError';
  }
}

const targetWriteLocks = new Map<string, Promise<void>>();

async function withTargetWriteLock<T>(absolutePath: string, operation: () => Promise<T>): Promise<T> {
  const key = process.platform === 'win32' ? path.resolve(absolutePath).toLowerCase() : path.resolve(absolutePath);
  const previous = targetWriteLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  targetWriteLocks.set(key, gate);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (targetWriteLocks.get(key) === gate) targetWriteLocks.delete(key);
  }
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
  options?: AtomicWriteOptions,
): Promise<WorkspaceAttachment> {
  const absolute = resolveWorkspacePath(workspaceRoot, relativePath);
  throwIfWriteCancelled(options?.signal, relativePath);
  return withTargetWriteLock(absolute, () => writeWorkspaceFileAtomicallyLocked(
    workspaceRoot,
    relativePath,
    absolute,
    writer,
    options,
  ));
}

async function writeWorkspaceFileAtomicallyLocked(
  workspaceRoot: string,
  relativePath: string,
  absolute: string,
  writer: (temporaryPath: string) => Promise<void>,
  options?: AtomicWriteOptions,
): Promise<WorkspaceAttachment> {
  const directory = path.dirname(absolute);
  const basename = path.basename(absolute);
  // Keep the original extension: libraries such as ExcelJS select their
  // serializer from the destination suffix.
  const extension = path.extname(basename) || '.tmp';
  const temporaryPath = path.join(directory, `.${basename}.shorekeeper-${randomUUID()}${extension}`);
  const backupPath = path.join(directory, `.${basename}.shorekeeper-${randomUUID()}.bak`);
  let backupCreated = false;
  let committed = false;
  let durableBackupPath: string | null = null;

  try {
    throwIfWriteCancelled(options?.signal, relativePath);
    await fs.mkdir(directory, { recursive: true });
    throwIfWriteCancelled(options?.signal, relativePath);
    await writer(temporaryPath);
    throwIfWriteCancelled(options?.signal, relativePath);

    const temporaryStat = await fs.stat(temporaryPath);
    if (!temporaryStat.isFile()) {
      throw new Error('生成结果不是普通文件');
    }
    const temporaryDigest = await fileDigest(temporaryPath);
    throwIfWriteCancelled(options?.signal, relativePath);

    if (
      options?.expectedRevision &&
      (await getWorkspaceFileRevision(workspaceRoot, relativePath)) !== options.expectedRevision
    ) {
      throw new StaleWorkspaceRevisionError(relativePath);
    }
    throwIfWriteCancelled(options?.signal, relativePath);

    // Only create a durable backup after the commit-time revision check. A stale
    // preview must not leave behind a misleading backup for a write that never happened.
    if (options?.preserveBackup ?? isImportantWorkspacePath(relativePath)) {
      try {
        await fs.stat(absolute);
        durableBackupPath = workspaceBackupPath(
          workspaceRoot,
          relativePath,
          `${Date.now()}-${randomUUID()}`,
        );
        await fs.mkdir(path.dirname(durableBackupPath), { recursive: true });
        await fs.copyFile(absolute, durableBackupPath);
        throwIfWriteCancelled(options?.signal, relativePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        durableBackupPath = null;
      }
    }

    try {
      throwIfWriteCancelled(options?.signal, relativePath);
      await fs.rename(absolute, backupPath);
      backupCreated = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    throwIfWriteCancelled(options?.signal, relativePath);
    await fs.rename(temporaryPath, absolute);
    committed = true;
    const readBackDigest = await fileDigest(absolute);
    const artifact = await buildFileArtifact(workspaceRoot, relativePath, { sha256: readBackDigest });

    if (artifact.size !== temporaryStat.size) {
      throw new Error('生成文件校验失败：文件大小发生变化');
    }
    if (readBackDigest !== temporaryDigest) {
      throw new Error('生成文件校验失败：写入后读回内容不一致');
    }
    throwIfWriteCancelled(options?.signal, relativePath);
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
