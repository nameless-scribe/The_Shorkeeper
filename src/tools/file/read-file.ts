import fs from 'node:fs/promises';
import path from 'node:path';
import type { ToolDefinition } from '../types';

function resolveWorkspacePath(workspaceRoot: string, relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const resolved = path.resolve(workspaceRoot, normalized);
  const root = path.resolve(workspaceRoot);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error(`路径越界：${relativePath} 不在工作区内`);
  }
  return resolved;
}

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
