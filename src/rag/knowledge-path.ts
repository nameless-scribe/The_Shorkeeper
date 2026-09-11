import path from 'node:path';
import { getWorkspaceDir } from '../config/paths';
import { resolveWorkspacePath } from '../tools/file/workspace-path';

export function getKnowledgeDir(): string {
  return resolveWorkspacePath(getWorkspaceDir(), 'knowledge');
}

/** 安全化 knowledge 文件名，拒绝路径穿越 */
export function sanitizeKnowledgeFilename(filename: string): string {
  const normalized = filename.replace(/\\/g, '/');
  if (normalized.includes('..')) {
    throw new Error('文件名不能包含 ..');
  }
  const base = path.basename(normalized);
  if (!base || base === '.' || base === '..') {
    throw new Error('无效的文件名');
  }
  if (base.includes('..')) {
    throw new Error('文件名不能包含 ..');
  }
  const safe = base.replace(/[<>:"|?*\\]/g, '_').trim();
  if (!safe) {
    throw new Error('无效的文件名');
  }
  return safe;
}

/** 校验绝对路径在 knowledge 目录内 */
export function assertPathWithinKnowledge(absolutePath: string): void {
  const workspaceRoot = path.resolve(getWorkspaceDir());
  const relative = path.relative(workspaceRoot, path.resolve(absolutePath));
  const resolved = resolveWorkspacePath(workspaceRoot, relative);
  const knowledgeRoot = getKnowledgeDir();
  if (resolved !== knowledgeRoot && !resolved.startsWith(knowledgeRoot + path.sep)) {
    throw new Error('路径越界：不在 knowledge 目录内');
  }
}

/** 校验文档相对路径对应的文件在 knowledge 目录内 */
export function resolveKnowledgeFilePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/');
  const resolved = resolveWorkspacePath(getWorkspaceDir(), normalized);
  const knowledgeRoot = getKnowledgeDir();
  if (resolved !== knowledgeRoot && !resolved.startsWith(knowledgeRoot + path.sep)) {
    throw new Error('路径越界：不在 knowledge 目录内');
  }
  return resolved;
}
