import fs from 'node:fs/promises';
import path from 'node:path';
import type { ToolDefinition } from '../types';

function resolveWorkspacePath(workspaceRoot: string, relativePath: string): string {
  const normalized = (relativePath || '.').replace(/\\/g, '/').replace(/^\/+/, '');
  const resolved = path.resolve(workspaceRoot, normalized);
  const root = path.resolve(workspaceRoot);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error(`路径越界：${relativePath} 不在工作区内`);
  }
  return resolved;
}

export const listDirTool: ToolDefinition = {
  name: 'list_dir',
  description: '列出工作区内指定目录的文件和子目录',
  category: 'file',
  requiresPermission: ['filesystem:read'],
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '相对于工作区根目录的目录路径，默认为根目录',
      },
    },
  },
  async execute(args, ctx) {
    const { path: dirPath = '.' } = args as { path?: string };

    try {
      const absolute = resolveWorkspacePath(ctx.workspaceRoot, dirPath);
      const entries = await fs.readdir(absolute, { withFileTypes: true });
      const lines = entries.map((entry) => {
        const kind = entry.isDirectory() ? 'dir' : 'file';
        return `${kind}\t${entry.name}`;
      });
      return {
        success: true,
        output: lines.length ? lines.join('\n') : '(空目录)',
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: message };
    }
  },
};
