import fs from 'node:fs/promises';
import path from 'node:path';
import type { ToolDefinition } from '../types';
import { resolveWorkspacePath } from './workspace-path';

export const writeFileTool: ToolDefinition = {
  name: 'write_file',
  description: '在工作区内创建或覆盖写入文本文件',
  category: 'file',
  requiresPermission: ['filesystem:write'],
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '相对于工作区根目录的文件路径',
      },
      content: {
        type: 'string',
        description: '要写入的文本内容',
      },
    },
    required: ['path', 'content'],
  },
  async execute(args, ctx) {
    const { path: filePath, content } = args as { path?: string; content?: string };
    if (!filePath?.trim()) {
      return { success: false, output: '', error: '缺少 path 参数' };
    }
    if (content == null) {
      return { success: false, output: '', error: '缺少 content 参数' };
    }

    try {
      const absolute = resolveWorkspacePath(ctx.workspaceRoot, filePath);
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await fs.writeFile(absolute, content, 'utf-8');
      return {
        success: true,
        output: `已写入 ${filePath}（${Buffer.byteLength(content, 'utf-8')} 字节）`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: message };
    }
  },
};
