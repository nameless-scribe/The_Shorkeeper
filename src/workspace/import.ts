import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getWorkspaceDir } from '../config/paths';
import {
  classifyWorkspaceFile,
  isWorkspaceImportableExtension,
  workspaceFileToolHint,
  workspaceFileToolHintLabel,
  workspaceImportLimitBytes,
  type WorkspaceAttachmentKind,
} from './allowed-extensions';

export interface WorkspaceImportResult {
  relativePath: string;
  originalName: string;
  size: number;
  /** 文本 / Office / 录音。决定上下文里怎么介绍它、以及导入大小上限 */
  kind?: WorkspaceAttachmentKind;
}

export interface WorkspaceImportRecoveryResult {
  cleaned: number;
  retained: number;
}

const IMPORT_TEMP_PREFIX = '.shorekeeper-import-';

export async function recoverWorkspaceImportTemps(): Promise<WorkspaceImportRecoveryResult> {
  const root = ensureWorkspace();
  const result: WorkspaceImportRecoveryResult = { cleaned: 0, retained: 0 };
  const entries = await fsPromises.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.name.startsWith(IMPORT_TEMP_PREFIX) || !entry.name.endsWith('.tmp')) continue;
    if (!entry.isFile()) {
      result.retained += 1;
      continue;
    }
    await fsPromises.unlink(path.join(root, entry.name));
    result.cleaned += 1;
  }
  return result;
}

function ensureWorkspace(): string {
  const root = path.resolve(getWorkspaceDir());
  fs.mkdirSync(root, { recursive: true });
  return root;
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"|?*\\]/g, '_').replace(/\.\./g, '_').trim() || 'file';
}

async function readBoundedFile(filePath: string, maxBytes: number): Promise<Buffer> {
  const handle = await fsPromises.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('不是有效文件');
    if (stat.size > maxBytes) {
      throw new Error(`文件超过 ${maxBytes / (1024 * 1024)}MB 上限`);
    }

    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1 - total));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > maxBytes) {
        throw new Error(`文件超过 ${maxBytes / (1024 * 1024)}MB 上限`);
      }
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, total);
  } finally {
    await handle.close();
  }
}

async function writeCompleteImport(
  root: string,
  safeBase: string,
  content: Buffer,
): Promise<string> {
  const parsed = path.parse(safeBase);
  const tempPath = path.join(root, `${IMPORT_TEMP_PREFIX}${randomUUID()}.tmp`);
  let linkedPath: string | null = null;
  try {
    const handle = await fsPromises.open(tempPath, 'wx');
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }

    for (let counter = 0; ; counter += 1) {
      const destName = counter === 0 ? safeBase : `${parsed.name}_${counter}${parsed.ext}`;
      const destPath = path.join(root, destName);
      try {
        // Linking a fully-written temporary file makes name allocation atomic and
        // prevents two concurrent imports from overwriting one another.
        await fsPromises.link(tempPath, destPath);
        linkedPath = destPath;
        const written = await fsPromises.readFile(destPath);
        if (!written.equals(content)) throw new Error('工作区文件写入校验失败');
        return destName;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
        if (linkedPath === destPath) {
          await fsPromises.unlink(destPath).catch(() => undefined);
          linkedPath = null;
        }
        throw error;
      }
    }
  } finally {
    await fsPromises.unlink(tempPath).catch((error) => {
      console.warn('[workspace] 临时导入文件清理失败:', tempPath, error);
    });
  }
}

export async function importFileToWorkspace(sourcePath: string): Promise<WorkspaceImportResult> {
  const root = ensureWorkspace();
  const resolvedSource = await fsPromises.realpath(path.resolve(sourcePath));

  // 先按扩展名分类再读：录音的上限是 100MB，文档是 20MB，读之前就要知道用哪个
  const ext = path.extname(resolvedSource).toLowerCase();
  if (ext && !isWorkspaceImportableExtension(ext)) {
    throw new Error(`不支持的文件类型 ${ext}，请使用文本、Word、Excel 或录音文件`);
  }
  const kind = classifyWorkspaceFile(ext);
  const content = await readBoundedFile(resolvedSource, workspaceImportLimitBytes(kind));

  const originalName = path.basename(resolvedSource);
  const safeBase = sanitizeFilename(originalName);
  const destName = await writeCompleteImport(root, safeBase, content);

  return { relativePath: destName, originalName, size: content.byteLength, kind };
}

export function formatAttachmentsForMessage(
  text: string,
  attachments: WorkspaceImportResult[],
): string {
  if (!attachments.length) return text;

  const lines = attachments.map((a) => {
    const ext = path.extname(a.originalName).toLowerCase();
    const kind = a.kind ?? classifyWorkspaceFile(ext);
    if (kind === 'audio') {
      // 录音不是可读内容：告诉模型它在哪、该用什么工具，而不是让它去 read_file 读二进制。
      // 措辞避开技能触发词——附件本身不该替用户决定要不要出纪要。
      return `- ${a.originalName} → 工作区: ${a.relativePath}（${a.size} 字节，这是录音文件，需要文字内容时用 transcribe_audio 生成文稿，不要用 read_file 读取）`;
    }
    if (kind === 'image') {
      // 图片同理：只给路径，不自动描述（P8 §3.3），措辞不含技能触发词
      return `- ${a.originalName} → 工作区: ${a.relativePath}（${a.size} 字节，这是图片，需要内容时用 look_at_image 提问，不要用 read_file 读取）`;
    }
    const tool = workspaceFileToolHintLabel(workspaceFileToolHint(ext));
    return `- ${a.originalName} → 工作区: ${a.relativePath}（${a.size} 字节，建议 ${tool}）`;
  });

  return `[用户已上传以下文件到工作区]\n${lines.join('\n')}\n\n${text}`;
}

export { getWorkspaceDir };
