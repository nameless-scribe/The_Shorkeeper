import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import type { ToolResult } from '../types';
import { resolveWorkspacePath } from './workspace-path';

const TEXT_PREVIEW_CHARS = 6_000;
const TEXT_PREVIEW_BYTES = 24_000;
export const MISSING_FILE_REVISION = 'missing';

function revisionFromDigest(digest: string, size: number): string {
  return `sha256:${digest}:${size}`;
}

export function revisionForBuffer(contents: Uint8Array): string {
  return revisionFromDigest(createHash('sha256').update(contents).digest('hex'), contents.byteLength);
}

async function digestFile(absolutePath: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(absolutePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', resolve);
  });
  return hash.digest('hex');
}

export async function getWorkspaceFileRevision(
  workspaceRoot: string,
  relativePath: string,
): Promise<string> {
  const absolute = resolveWorkspacePath(workspaceRoot, relativePath);
  try {
    const stat = await fs.stat(absolute);
    if (!stat.isFile()) throw new Error(`目标不是普通文件：${relativePath}`);
    return revisionFromDigest(await digestFile(absolute), stat.size);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return MISSING_FILE_REVISION;
    throw error;
  }
}

export interface TextPreviewValue {
  content: string;
  truncated: boolean;
}

export function truncatePreviewText(content: string): TextPreviewValue {
  if (content.length <= TEXT_PREVIEW_CHARS) return { content, truncated: false };
  return { content: `${content.slice(0, TEXT_PREVIEW_CHARS)}\n…`, truncated: true };
}

export async function readWorkspaceTextPreview(
  workspaceRoot: string,
  relativePath: string,
): Promise<TextPreviewValue & { exists: boolean; revision: string }> {
  const absolute = resolveWorkspacePath(workspaceRoot, relativePath);
  try {
    const stat = await fs.stat(absolute);
    if (!stat.isFile()) throw new Error(`目标不是普通文件：${relativePath}`);
    const handle = await fs.open(absolute, 'r');
    try {
      const bytes = Math.min(stat.size, TEXT_PREVIEW_BYTES);
      const buffer = Buffer.alloc(bytes);
      if (bytes > 0) await handle.read(buffer, 0, bytes, 0);
      const preview = truncatePreviewText(buffer.toString('utf8'));
      return {
        ...preview,
        truncated: preview.truncated || stat.size > bytes,
        exists: true,
        revision: revisionFromDigest(await digestFile(absolute), stat.size),
      };
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { content: '', truncated: false, exists: false, revision: MISSING_FILE_REVISION };
    }
    throw error;
  }
}

export async function previewRevisionIsCurrent(
  workspaceRoot: string,
  relativePath: string,
  expectedRevision: string | undefined,
): Promise<boolean> {
  if (!expectedRevision) return true;
  return (await getWorkspaceFileRevision(workspaceRoot, relativePath)) === expectedRevision;
}

export function stalePreviewResult(target: string): ToolResult {
  return {
    success: false,
    output: '',
    error: `预览已过期：${target} 在确认期间发生了变化，请重新发起操作`,
    errorCategory: 'internal_error',
    metadata: { previewStale: true },
  };
}
