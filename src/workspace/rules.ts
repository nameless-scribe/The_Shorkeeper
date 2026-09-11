import path from 'node:path';
import { resolveWorkspacePath } from '../tools/file/workspace-path';

const IMPORTANT_DIRS = new Set(['important', '重要', 'protected']);
const GENERATED_DIRS = new Set(['generated', 'reports', 'exports', 'output', 'important', '重要']);

export function isImportantWorkspacePath(relativePath: string): boolean {
  const firstSegment = relativePath.replace(/\\/g, '/').split('/')[0]?.toLocaleLowerCase();
  return firstSegment ? IMPORTANT_DIRS.has(firstSegment) : false;
}

export function isGeneratedWorkspacePath(relativePath: string): boolean {
  const firstSegment = relativePath.replace(/\\/g, '/').split('/')[0]?.toLocaleLowerCase();
  return firstSegment ? GENERATED_DIRS.has(firstSegment) : false;
}

export function buildGeneratedWorkspacePath(
  kind: 'report' | 'export' | 'generated',
  name: string,
  extension: string,
): string {
  const safeName = name
    .normalize('NFKC')
    .trim()
    .replace(/[<>:"|?*\\/]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'untitled';
  const safeExtension = extension.startsWith('.') ? extension : `.${extension}`;
  const date = new Date().toISOString().slice(0, 10);
  return `${kind === 'generated' ? 'generated' : kind === 'report' ? 'reports' : 'exports'}/${date}-${safeName}${safeExtension}`;
}

export function workspaceBackupPath(root: string, relativePath: string, suffix: string): string {
  const label = relativePath
    .replace(/\\/g, '/')
    .replace(/[^a-zA-Z0-9\u4e00-\u9fff._-]+/g, '_');
  return resolveWorkspacePath(
    root,
    path.posix.join('.shorekeeper-backups', `${label}-${suffix}.bak`),
  );
}
