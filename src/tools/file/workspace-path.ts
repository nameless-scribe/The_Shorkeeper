import path from 'node:path';

export function resolveWorkspacePath(workspaceRoot: string, relativePath: string): string {
  const normalized = (relativePath || '.').replace(/\\/g, '/').replace(/^\/+/, '');
  const resolved = path.resolve(workspaceRoot, normalized);
  const root = path.resolve(workspaceRoot);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error(`路径越界：${relativePath} 不在工作区内`);
  }
  return resolved;
}
