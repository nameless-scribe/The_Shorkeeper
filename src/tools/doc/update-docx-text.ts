import fs from 'node:fs/promises';
import type { ToolDefinition, ToolResult } from '../types';
import { CONTENT_DEPENDENT_WRITE_CONTRACT } from '../contract';
import { withFileArtifact, writeWorkspaceFileAtomically } from '../file/artifact';
import { getWorkspaceFileRevision, stalePreviewResult, truncatePreviewText } from '../file/preview';
import { resolveWorkspacePath } from '../file/workspace-path';
import {
  applyDocxTextEdits,
  DocxTextEditError,
  MAX_DOCX_TEXT_EDITS,
  type DocxTextEdit,
  type DocxTextEditResult,
} from '../../documents/docx-text-edit';
import { readDocxPackage, replaceDocxDocumentXml } from '../../documents/docx-package';

function invalid(error: string): ToolResult {
  return { success: false, output: '', error, errorCategory: 'invalid_arguments' };
}

function isDocxPath(value: string): boolean {
  return value.trim().toLowerCase().endsWith('.docx');
}

function samePath(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function describeChanges(result: DocxTextEditResult) {
  const before = result.changes.map((change) => change.before).join('\n\n');
  const after = result.changes.map((change) => change.after).join('\n\n');
  return {
    before: truncatePreviewText(before),
    after: truncatePreviewText(after),
    changes: result.changes.map((change) => ({
      label: `第 ${change.paragraph} 段`,
      before: change.before,
      after: change.after,
    })),
    total: result.edits.reduce((sum, edit) => sum + edit.replaced, 0),
  };
}

export const updateDocxTextTool: ToolDefinition = {
  name: 'update_docx_text',
  description:
    '原位修改工作区内已有 Word (.docx) 的正文文字：按段落精确匹配原文并替换，保留字体、编号、表格等版式；改不了页眉页脚与批注，含修订记录的文档须先在 Word 里接受修订',
  category: 'file',
  requiresPermission: ['filesystem:read', 'filesystem:write'],
  sideEffects: CONTENT_DEPENDENT_WRITE_CONTRACT,
  parameters: {
    type: 'object',
    properties: {
      source_path: { type: 'string', description: '要修改的 .docx 相对路径' },
      output_path: {
        type: 'string',
        description: '输出路径（.docx）；省略则覆盖源文件并保留备份',
      },
      edits: {
        type: 'array',
        description: `修改列表，最多 ${MAX_DOCX_TEXT_EDITS} 项，依次生效。find 是同一段落内的精确原文（不能跨段落，不能含换行或制表符），先用 convert_to_markdown 看清原文再写`,
        items: {
          type: 'object',
          properties: {
            find: { type: 'string', description: '要替换的原文，须与文档里的文字逐字一致' },
            replace: { type: 'string', description: '替换后的文字，可为空串表示删除' },
            occurrence: {
              type: 'string',
              enum: ['first', 'all'],
              description: '只替换第一处（默认）还是全文所有命中处',
            },
          },
          required: ['find', 'replace'],
        },
      },
    },
    required: ['source_path', 'edits'],
  },
  async execute(args, ctx) {
    const { source_path, output_path, edits } = args as {
      source_path?: string;
      output_path?: string;
      edits?: DocxTextEdit[];
    };
    const sourcePath = source_path?.trim();
    if (!sourcePath) return invalid('缺少 source_path 参数');
    if (!isDocxPath(sourcePath)) return invalid('source_path 须为 .docx 文件；旧版 .doc 请先另存为 .docx');
    const outputPath = output_path?.trim() || sourcePath;
    if (!isDocxPath(outputPath)) return invalid('output_path 须以 .docx 结尾');
    if (!Array.isArray(edits) || edits.length === 0) return invalid('edits 必须是非空数组');
    if (edits.length > MAX_DOCX_TEXT_EDITS) return invalid(`单次最多 ${MAX_DOCX_TEXT_EDITS} 处修改`);

    try {
      const sourceAbsolute = resolveWorkspacePath(ctx.workspaceRoot, sourcePath);
      const outputAbsolute = resolveWorkspacePath(ctx.workspaceRoot, outputPath);
      const overwritesSource = samePath(sourceAbsolute, outputAbsolute);

      const readRevision = async () => {
        const source = await getWorkspaceFileRevision(ctx.workspaceRoot, sourcePath);
        const output = overwritesSource ? source : await getWorkspaceFileRevision(ctx.workspaceRoot, outputPath);
        return JSON.stringify({ source, output });
      };
      const revision = await readRevision();
      if (ctx.previewRevision && revision !== ctx.previewRevision) {
        return stalePreviewResult(outputPath);
      }

      const sourceBuffer = await fs.readFile(sourceAbsolute);
      const pkg = await readDocxPackage(sourceBuffer);
      let result: DocxTextEditResult;
      try {
        result = applyDocxTextEdits(pkg.documentXml, edits);
      } catch (error) {
        if (error instanceof DocxTextEditError) {
          return {
            success: false,
            output: '',
            error: `${error.message}；文件未修改`,
            errorCategory: error.reason === 'malformed' ? 'internal_error' : 'invalid_arguments',
            metadata: { reason: error.reason },
          };
        }
        throw error;
      }

      const described = describeChanges(result);
      if (ctx.preview) {
        return {
          success: true,
          output: `预览：将在 ${sourcePath} 替换 ${described.total} 处文字，涉及 ${result.changes.length} 段`,
          preview: {
            kind: 'text-diff',
            target: outputPath,
            summary: `${overwritesSource ? '覆盖源文件（保留备份）' : `写入 ${outputPath}`}，替换 ${described.total} 处、${result.changes.length} 段；确认前不会修改`,
            revision,
            details: [
              `来源：${sourcePath}`,
              ...result.edits.map((edit) => `「${edit.find}」→「${edit.replace}」× ${edit.replaced}`),
            ],
            before: described.before.content,
            after: described.after.content,
            beforeTruncated: described.before.truncated,
            afterTruncated: described.after.truncated,
            changes: described.changes,
          },
        };
      }

      if (ctx.previewRevision && (await readRevision()) !== ctx.previewRevision) {
        return stalePreviewResult(outputPath);
      }
      const packed = await replaceDocxDocumentXml(sourceBuffer, result.xml);
      const artifact = await writeWorkspaceFileAtomically(
        ctx.workspaceRoot,
        outputPath,
        (temporaryPath) => fs.writeFile(temporaryPath, packed),
        { preserveBackup: overwritesSource },
      );
      return withFileArtifact(
        {
          success: true,
          output: `已在 ${outputPath} 替换 ${described.total} 处文字（${result.changes.length} 段），版式未动`,
          metadata: {
            replacements: described.total,
            paragraphs: result.changes.map((change) => change.paragraph),
            edits: result.edits,
          },
        },
        artifact,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, output: '', error: message };
    }
  },
};
