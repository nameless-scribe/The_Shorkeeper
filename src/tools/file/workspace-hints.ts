import fs from 'node:fs/promises';
import path from 'node:path';

/** 去掉中文书名号、空白，便于模糊比对文件名 */
export function normalizeFilenameForMatch(name: string): string {
  return name
    .replace(/[《》【】\[\]()（）\s_\-]/g, '')
    .toLowerCase();
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

async function listWorkspaceEntries(
  workspaceRoot: string,
  dirRelative: string,
): Promise<string[]> {
  const absolute = path.resolve(workspaceRoot, dirRelative);
  const entries = await fs.readdir(absolute, { withFileTypes: true });
  return entries.map((e) => (dirRelative === '.' ? e.name : `${dirRelative}/${e.name}`));
}

export async function buildPathNotFoundHint(
  workspaceRoot: string,
  requestedPath: string,
): Promise<string | null> {
  const normalized = requestedPath.replace(/\\/g, '/');
  const parent = path.posix.dirname(normalized);
  const base = path.posix.basename(normalized);
  const searchDirs = parent === '.' ? ['.'] : [parent, '.'];

  const wanted = normalizeFilenameForMatch(base);
  const candidates = new Set<string>();

  for (const dir of searchDirs) {
    try {
      const names = await listWorkspaceEntries(workspaceRoot, dir);
      for (const name of names) {
        const entryBase = path.posix.basename(name);
        const entryNorm = normalizeFilenameForMatch(entryBase);
        if (
          entryNorm.includes(wanted) ||
          wanted.includes(entryNorm) ||
          entryNorm === wanted
        ) {
          candidates.add(name.replace(/\\/g, '/'));
        }
      }
    } catch {
      /* parent may not exist */
    }
  }

  if (!candidates.size) {
    try {
      const rootFiles = await listWorkspaceEntries(workspaceRoot, '.');
      const preview = rootFiles.slice(0, 12).join(', ');
      return `路径不存在。工作区根目录文件示例：${preview}${rootFiles.length > 12 ? '…' : ''}。请先 list_dir "." 确认准确文件名（勿加《》书名号）。`;
    } catch {
      return '路径不存在。请先 list_dir "." 查看工作区实际文件列表，不要猜测子目录或文件名。';
    }
  }

  const list = [...candidates].slice(0, 5).join('、');
  return `路径不存在。可能想找：${list}。文件名须与工作区完全一致（不要加《》书名号，除非文件本身含该字符）。`;
}

export function enrichFsError(
  err: unknown,
  hint: string | null,
): string {
  const base = err instanceof Error ? err.message : String(err);
  if (!hint) return base;
  return `${base}\n\n提示：${hint}`;
}

export { isEnoent };
