import path from 'node:path';

export function normalizeDocumentTitle(title: string): string {
  return title.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

export function deriveDocumentTitle(
  text: string,
  filename: string,
  explicitTitle?: string,
): string {
  const requested = explicitTitle?.trim();
  if (requested) return requested;

  const heading = text.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim();
  if (heading) return heading;

  const ext = path.extname(filename);
  return path.basename(filename, ext).trim() || filename;
}

export function normalizeDocumentSourcePath(sourcePath: string): string {
  const normalized = path.resolve(sourcePath).normalize('NFKC').replace(/\\/g, '/');
  return process.platform === 'win32' ? normalized.toLocaleLowerCase() : normalized;
}
