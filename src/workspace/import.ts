import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { WORKSPACE_DIR } from '../config/paths';

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.json',
  '.csv',
  '.log',
  '.yaml',
  '.yml',
  '.xml',
  '.html',
  '.htm',
  '.css',
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
  '.py',
  '.sql',
  '.ini',
]);

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
  if (stat.size > MAX_FILE_SIZE) {
    throw new Error('文件超过 10MB 上限');
  }

  const ext = path.extname(resolvedSource).toLowerCase();
  if (ext && !ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(`不支持的文件类型 ${ext}，请使用文本类文件`);
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

  const lines = attachments.map(
    (a) => `- ${a.originalName} → 工作区路径: ${a.relativePath}（${a.size} 字节）`,
  );
  return `[用户已上传以下文件到工作区，可用 read_file / list_dir 读取]\n${lines.join('\n')}\n\n${text}`;
}

export { WORKSPACE_DIR };
