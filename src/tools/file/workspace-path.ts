import fs from 'node:fs';
import path from 'node:path';

function isWithinRoot(root: string, target: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(resolvedRoot + path.sep);
}

function realpathWithMissingTail(target: string): string {
  let cursor = target;
  const missing: string[] = [];

  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) return target;
    missing.unshift(path.basename(cursor));
    cursor = parent;
  }

  return path.resolve(fs.realpathSync(cursor), ...missing);
}

export function resolveWorkspacePath(workspaceRoot: string, relativePath: string): string {
  const raw = String(relativePath || '.').trim();
  const normalized = raw.replace(/\\/g, '/');

  // Tool contracts use workspace-relative paths. Reject all platform forms
  // of absolute paths instead of silently rebasing them under the workspace.
  if (
    path.isAbsolute(raw) ||
    path.posix.isAbsolute(normalized) ||
    path.win32.isAbsolute(normalized)
  ) {
    throw new Error(`路径必须是工作区内的相对路径：${relativePath}`);
  }

  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, normalized);

  if (!isWithinRoot(root, resolved)) {
    throw new Error(`路径越界：${relativePath} 不在工作区内`);
  }

  try {
    const realRoot = fs.realpathSync(root);
    // Resolve the nearest existing parent too. This catches a new file below
    // a symlink that points outside the workspace.
    const realResolved = realpathWithMissingTail(resolved);
    if (!isWithinRoot(realRoot, realResolved)) {
      throw new Error(`路径越界：${relativePath} 不在工作区内`);
    }
    return realResolved;
  } catch (err) {
    if (err instanceof Error && (err.message.includes('路径越界') || err.message.includes('必须是'))) {
      throw err;
    }
    return resolved;
  }
}

/** Check a tool-provided path against every configured workspace root. */
export function isPathWithinWorkspaceRoots(relativePath: string, roots: string[]): boolean {
  return roots.some((root) => {
    try {
      resolveWorkspacePath(root, relativePath);
      return true;
    } catch {
      return false;
    }
  });
}
