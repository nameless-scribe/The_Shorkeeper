import fs from 'node:fs/promises';
import type { ToolDefinition } from '../types';
import { PREVIEWABLE_WORKSPACE_WRITE_CONTRACT } from '../contract';
import { withFileArtifact, writeWorkspaceFileAtomically } from './artifact';
import {
  previewRevisionIsCurrent,
  readWorkspaceTextPreview,
  stalePreviewResult,
  truncatePreviewText,
} from './preview';

export const writeFileTool: ToolDefinition = {
  name: 'write_file',
  description: '在工作区内创建或覆盖写入文本文件',
  category: 'file',
  requiresPermission: ['filesystem:write'],
  sideEffects: PREVIEWABLE_WORKSPACE_WRITE_CONTRACT,
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
      if (ctx.preview) {
        const current = await readWorkspaceTextPreview(ctx.workspaceRoot, filePath);
        const next = truncatePreviewText(content);
        const bytes = Buffer.byteLength(content, 'utf-8');
        return {
          success: true,
          output: `预览：将${current.exists ? '覆盖' : '创建'} ${filePath}（${bytes} 字节）`,
          preview: {
            kind: 'text-diff',
            target: filePath,
            summary: `将${current.exists ? '覆盖现有文件' : '创建新文件'}，写入 ${bytes} 字节`,
            revision: current.revision,
            before: current.content,
            after: next.content,
            beforeTruncated: current.truncated,
            afterTruncated: next.truncated,
          },
        };
      }
      if (!await previewRevisionIsCurrent(ctx.workspaceRoot, filePath, ctx.previewRevision)) {
        return stalePreviewResult(filePath);
      }
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
