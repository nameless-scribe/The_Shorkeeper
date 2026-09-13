import fs from 'node:fs/promises';
import type { ToolDefinition } from '../types';
import { READ_ONLY_CONTRACT } from '../contract';
import { buildFileArtifact, withFileArtifact } from './artifact';
import { buildPathNotFoundHint, enrichFsError, isEnoent } from './workspace-hints';
import { resolveWorkspacePath } from './workspace-path';

const MAX_RETURN_CHARS = 100_000;
export const readFileTool: ToolDefinition = {
  name: 'read_file',
  description: '读取工作区内的文本文件内容',
  category: 'file',
  requiresPermission: ['filesystem:read'],
  sideEffects: READ_ONLY_CONTRACT,
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '相对于工作区根目录的文件路径',
      },
      start_line: {
        type: 'number',
        description: '可选，起始行（从 1 计数，包含）',
      },
      end_line: {
        type: 'number',
        description: '可选，结束行（从 1 计数，包含）',
      },
    },
    required: ['path'],
  },
  async execute(args, ctx) {
    const { path: filePath, start_line, end_line } = args as {
      path?: string;
      start_line?: number;
      end_line?: number;
    };
    if (!filePath?.trim()) {
      return { success: false, output: '', error: '缺少 path 参数' };
    }

    try {
      const absolute = resolveWorkspacePath(ctx.workspaceRoot, filePath);
      const content = await fs.readFile(absolute, 'utf-8');
      const hasRange = start_line != null || end_line != null;
      let output = content;
      let rangeMetadata: Record<string, unknown> | undefined;
      if (hasRange) {
        if (
          (start_line != null && (!Number.isFinite(start_line) || start_line < 1)) ||
          (end_line != null && (!Number.isFinite(end_line) || end_line < 1))
        ) {
          return { success: false, output: '', error: 'start_line/end_line 须为大于等于 1 的有限数字' };
        }
        const lines = content.split(/\r?\n/);
        const start = Math.max(1, Math.floor(start_line ?? 1));
        const end = Math.min(lines.length, Math.floor(end_line ?? start + 499));
        if (end < start) {
          return { success: false, output: '', error: 'end_line 不能小于 start_line' };
        }
        output = lines.slice(start - 1, end).join('\n');
        rangeMetadata = { startLine: start, endLine: end, totalLines: lines.length };
      }
      if (output.length > MAX_RETURN_CHARS) {
        return {
          success: false,
          output: '',
          error: `文件内容超过单次读取上限 ${MAX_RETURN_CHARS} 字符，请使用 start_line/end_line 分段读取`,
          metadata: { totalCharacters: content.length },
        };
      }
      const artifact = await buildFileArtifact(ctx.workspaceRoot, filePath);
      return withFileArtifact(
        {
          success: true,
          output,
          ...(rangeMetadata ? { metadata: rangeMetadata } : {}),
        },
        artifact,
      );
    } catch (err) {
      const hint = isEnoent(err)
        ? await buildPathNotFoundHint(ctx.workspaceRoot, filePath)
        : null;
      return { success: false, output: '', error: enrichFsError(err, hint) };
    }
  },
};
