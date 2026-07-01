import fs from 'node:fs';
import path from 'node:path';

export function resolveWorkspacePath(workspaceRoot: string, relativePath: string): string {
  const normalized = (relativePath || '.').replace(/\\/g, '/').replace(/^\/+/, '');
  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, normalized);

  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error(`路径越界：${relativePath} 不在工作区内`);
  }

  try {
    const realRoot = fs.realpathSync(root);
    const realResolved = fs.realpathSync(resolved);
    if (!realResolved.startsWith(realRoot + path.sep) && realResolved !== realRoot) {
      throw new Error(`路径越界：${relativePath} 不在工作区内`);
    }
    return realResolved;
  } catch (err) {
    if (err instanceof Error && err.message.includes('路径越界')) throw err;
    return resolved;
  }
}
