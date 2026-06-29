import fs from 'node:fs/promises';
import type { ToolDefinition } from '../types';
import { resolveWorkspacePath } from './workspace-path';

export const readFileTool: ToolDefinition = {
  name: 'read_file',
  description: '读取工作区内的文本文件内容',
  category: 'file',
  requiresPermission: ['filesystem:read'],
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '相对于工作区根目录的文件路径',
      },
    },
    required: ['path'],
  },
  async execute(args, ctx) {
    const { path: filePath } = args as { path?: string };
    if (!filePath?.trim()) {
      return { success: false, output: '', error: '缺少 path 参数' };
    }

    try {
      const absolute = resolveWorkspacePath(ctx.workspaceRoot, filePath);
      const content = await fs.readFile(absolute, 'utf-8');
      return { success: true, output: content };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: message };
    }
  },
};
