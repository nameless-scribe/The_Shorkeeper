import fs from 'node:fs/promises';
import path from 'node:path';
import { convertBinaryToMarkdown } from './format-converters';
import { importTextAsKnowledge, type ImportProgress } from './text-import';
import { AbortSignalError, awaitWithAbort } from '../agent/abort';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const TEXT_EXT = new Set(['.md', '.txt']);
const BINARY_EXT = new Set(['.docx', '.doc', '.pdf']);

export type { ImportProgress };

export async function importDocumentFromPath(
  sourcePath: string,
  onProgress?: (p: ImportProgress) => void,
  options?: { signal?: AbortSignal },
): Promise<import('./documents').DocumentInfo> {
  if (options?.signal?.aborted) throw new AbortSignalError();
  onProgress?.({ phase: 'reading' });

  const resolved = await fs.realpath(path.resolve(sourcePath));
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) throw new Error('不是有效文件');
  if (stat.size > MAX_FILE_SIZE) throw new Error('文件超过 10MB');

  const ext = path.extname(resolved).toLowerCase();
  const filename = path.basename(resolved);

  if (TEXT_EXT.has(ext)) {
    const text = await fs.readFile(resolved, { encoding: 'utf8', signal: options?.signal });
    return importTextAsKnowledge(text, filename, onProgress, {
      sourcePath: resolved,
      signal: options?.signal,
    });
  }

  if (BINARY_EXT.has(ext)) {
    const conversion = convertBinaryToMarkdown(resolved);
    const markdown = options?.signal
      ? await awaitWithAbort(conversion, options.signal)
      : await conversion;
    const mdFilename = filename.replace(/\.[^.]+$/, '.md');
    return importTextAsKnowledge(markdown, mdFilename, onProgress, {
      sourcePath: resolved,
      title: path.basename(filename, ext),
      signal: options?.signal,
    });
  }

  throw new Error('仅支持 .md / .txt / .docx / .doc / .pdf');
}

export { importTextAsKnowledge };
