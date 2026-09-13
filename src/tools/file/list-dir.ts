import fs from 'node:fs/promises';
import type { ToolDefinition } from '../types';
import { READ_ONLY_CONTRACT } from '../contract';
import { buildPathNotFoundHint, enrichFsError, isEnoent } from './workspace-hints';
import { resolveWorkspacePath } from './workspace-path';

export const listDirTool: ToolDefinition = {
  name: 'list_dir',
  description: '列出工作区内指定目录的文件和子目录',
  category: 'file',
  requiresPermission: ['filesystem:read'],
  sideEffects: READ_ONLY_CONTRACT,
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
      const hint = isEnoent(err)
        ? await buildPathNotFoundHint(ctx.workspaceRoot, dirPath)
        : null;
      return { success: false, output: '', error: enrichFsError(err, hint) };
    }
  },
};
