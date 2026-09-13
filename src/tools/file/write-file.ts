import fs from 'node:fs/promises';
import type { ToolDefinition } from '../types';
import { WORKSPACE_WRITE_CONTRACT } from '../contract';
import { withFileArtifact, writeWorkspaceFileAtomically } from './artifact';

export const writeFileTool: ToolDefinition = {
  name: 'write_file',
  description: '在工作区内创建或覆盖写入文本文件',
  category: 'file',
  requiresPermission: ['filesystem:write'],
  sideEffects: WORKSPACE_WRITE_CONTRACT,
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
      const artifact = await writeWorkspaceFileAtomically(
        ctx.workspaceRoot,
        filePath,
        (temporaryPath) => fs.writeFile(temporaryPath, content, 'utf-8'),
      );
      return withFileArtifact(
        {
          success: true,
          output: `已写入 ${filePath}（${Buffer.byteLength(content, 'utf-8')} 字节）`,
        },
        artifact,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: message };
    }
  },
};
