import path from 'node:path';
import type { WorkspaceImportResult } from './import';
import { getWorkspaceDir } from '../config/paths';
import { parseXlsxFile, formatParsedXlsxForPrompt } from '../tools/doc/parse-xlsx';

function ensureWorkspace(): string {
  const root = path.resolve(getWorkspaceDir());
  return root;
}

export async function enrichAttachmentsMessage(
  text: string,
  attachments: WorkspaceImportResult[],
): Promise<string> {
  if (!attachments.length) return text;

  const xlsxAttachments = attachments.filter((a) =>
    path.extname(a.relativePath).toLowerCase() === '.xlsx',
  );
  if (!xlsxAttachments.length) return text;

  const workspaceRoot = ensureWorkspace();
  const blocks: string[] = [];

  for (const attachment of xlsxAttachments) {
    try {
      const parsed = await parseXlsxFile(workspaceRoot, attachment.relativePath);
      blocks.push(
        `[工作区附件已解析]\n${formatParsedXlsxForPrompt(parsed)}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      blocks.push(
        `[工作区附件解析失败] ${attachment.originalName}（${attachment.relativePath}）\n错误: ${message}`,
      );
    }
  }

  if (!blocks.length) return text;
  return `${text}\n\n${blocks.join('\n\n')}`;
}
