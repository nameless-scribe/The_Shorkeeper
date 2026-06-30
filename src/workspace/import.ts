import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { WORKSPACE_DIR } from '../config/paths';
import {
  MAX_WORKSPACE_IMPORT_BYTES,
  WORKSPACE_IMPORT_EXTENSIONS,
  workspaceFileToolHint,
  workspaceFileToolHintLabel,
} from './allowed-extensions';

export interface WorkspaceImportResult {
  relativePath: string;
  originalName: string;
  size: number;
}

function ensureWorkspace(): string {
  const root = path.resolve(WORKSPACE_DIR);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"|?*\\]/g, '_').replace(/\.\./g, '_').trim() || 'file';
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fsPromises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function importFileToWorkspace(sourcePath: string): Promise<WorkspaceImportResult> {
  const root = ensureWorkspace();
  const resolvedSource = path.resolve(sourcePath);

  const stat = await fsPromises.stat(resolvedSource);
  if (!stat.isFile()) {
    throw new Error('不是有效文件');
  }
  if (stat.size > MAX_WORKSPACE_IMPORT_BYTES) {
    throw new Error(`文件超过 ${MAX_WORKSPACE_IMPORT_BYTES / (1024 * 1024)}MB 上限`);
  }

  const ext = path.extname(resolvedSource).toLowerCase();
  if (ext && !WORKSPACE_IMPORT_EXTENSIONS.has(ext)) {
    throw new Error(`不支持的文件类型 ${ext}，请使用文本、Word 或 Excel 文件`);
  }

  const originalName = path.basename(resolvedSource);
  const safeBase = sanitizeFilename(originalName);
  const parsed = path.parse(safeBase);
  let destName = safeBase;
  let destPath = path.join(root, destName);
  let counter = 1;

  while (await fileExists(destPath)) {
    destName = `${parsed.name}_${counter}${parsed.ext}`;
    destPath = path.join(root, destName);
    counter += 1;
  }

  await fsPromises.copyFile(resolvedSource, destPath);

  const relativePath = path.relative(root, destPath).replace(/\\/g, '/');
  return { relativePath, originalName, size: stat.size };
}

export function formatAttachmentsForMessage(
  text: string,
  attachments: WorkspaceImportResult[],
): string {
  if (!attachments.length) return text;

  const lines = attachments.map((a) => {
    const ext = path.extname(a.originalName).toLowerCase();
    const tool = workspaceFileToolHintLabel(workspaceFileToolHint(ext));
    return `- ${a.originalName} → 工作区: ${a.relativePath}（${a.size} 字节，建议 ${tool}）`;
  });

  return `[用户已上传以下文件到工作区]\n${lines.join('\n')}\n\n${text}`;
}

export { WORKSPACE_DIR };
