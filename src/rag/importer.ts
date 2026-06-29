import fs from 'node:fs/promises';
import path from 'node:path';
import { getWorkspaceDir } from '../config/paths';
import { importTextAsKnowledge, type ImportProgress } from './text-import';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_EXT = new Set(['.md', '.txt']);

export type { ImportProgress };

export async function importDocumentFromPath(
  sourcePath: string,
  onProgress?: (p: ImportProgress) => void,
): Promise<import('./documents').DocumentInfo> {
  onProgress?.({ phase: 'reading' });

  const resolved = path.resolve(sourcePath);
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) throw new Error('不是有效文件');
  if (stat.size > MAX_FILE_SIZE) throw new Error('文件超过 10MB');

  const ext = path.extname(resolved).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) throw new Error('M5 仅支持 .md / .txt');

  const text = await fs.readFile(resolved, 'utf8');
  const filename = path.basename(resolved);

  return importTextAsKnowledge(text, filename, onProgress);
}

export { importTextAsKnowledge };
