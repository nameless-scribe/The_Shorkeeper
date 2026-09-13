import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { ToolDefinition } from '../types';
import { withFileArtifact, writeWorkspaceFileAtomically } from './artifact';
import { resolveWorkspacePath } from './workspace-path';

function countOccurrences(content: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let offset = 0;
  while (true) {
    const index = content.indexOf(needle, offset);
    if (index < 0) return count;
    count += 1;
    offset = index + needle.length;
  }
}

export const replaceTextTool: ToolDefinition = {
  name: 'replace_text',
  description: '在工作区文本文件中精确替换已知片段；匹配数量不符时拒绝写入',
  category: 'file',
  requiresPermission: ['filesystem:read', 'filesystem:write'],
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '工作区内的相对路径' },
      old_text: { type: 'string', description: '必须精确匹配的原文' },
      new_text: { type: 'string', description: '替换后的文本' },
      expected_replacements: {
        type: 'number',
        description: '期望匹配次数，默认 1；实际数量不一致则不写入',
      },
    },
    required: ['path', 'old_text', 'new_text'],
  },
  async execute(args, ctx) {
    const { path: filePath, old_text, new_text, expected_replacements = 1 } = args as {
      path?: string;
      old_text?: string;
      new_text?: string;
      expected_replacements?: number;
    };
    if (!filePath?.trim()) return { success: false, output: '', error: '缺少 path 参数' };
    if (!old_text) return { success: false, output: '', error: 'old_text 不能为空' };
    if (new_text == null) return { success: false, output: '', error: '缺少 new_text 参数' };
    if (!Number.isInteger(expected_replacements) || expected_replacements < 1 || expected_replacements > 1000) {
      return { success: false, output: '', error: 'expected_replacements 须为 1 到 1000 的整数' };
    }

    try {
      const absolute = resolveWorkspacePath(ctx.workspaceRoot, filePath);
      const current = await fs.readFile(absolute, 'utf-8');
      const actual = countOccurrences(current, old_text);
      if (actual !== expected_replacements) {
        return {
          success: false,
          output: '',
          error: `替换前校验失败：期望匹配 ${expected_replacements} 次，实际匹配 ${actual} 次；文件未修改`,
          metadata: { expectedReplacements: expected_replacements, actualReplacements: actual },
        };
      }
      const next = current.split(old_text).join(new_text);
      const artifact = await writeWorkspaceFileAtomically(
        ctx.workspaceRoot,
        filePath,
        (temporaryPath) => fs.writeFile(temporaryPath, next, 'utf-8'),
        { preserveBackup: true },
      );
      const digest = createHash('sha256').update(next).digest('hex');
      return withFileArtifact(
        {
          success: true,
          output: `已在 ${filePath} 精确替换 ${actual} 处内容`,
          metadata: { replacements: actual, sha256: digest },
        },
        artifact,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: message };
    }
  },
};
