/**
 * 聊天里只读预览工作区图片：读成 data URL 交给 `<img>`（CSP `img-src` 已允许 `data:`）。
 * P5.3 为图表产物加的最小实现；P8.1 的附件缩略图若改走协议，这里可以退役。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveWorkspacePath } from '../tools/file/workspace-path';

export const PREVIEWABLE_IMAGE_MIME: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/** 预览上限：图表产物几十 KB，照片另有 P8 的路径；超过就不内联，卡片仍可打开 */
export const MAX_PREVIEW_IMAGE_BYTES = 4 * 1024 * 1024;

export function isPreviewableImagePath(relativePath: string): boolean {
  return path.extname(relativePath).toLowerCase() in PREVIEWABLE_IMAGE_MIME;
}

export async function readWorkspaceImageDataUrl(workspaceRoot: string, relativePath: string): Promise<string | null> {
  const mime = PREVIEWABLE_IMAGE_MIME[path.extname(relativePath).toLowerCase()];
  if (!mime) return null;
  const absolute = resolveWorkspacePath(workspaceRoot, relativePath);
  const stat = await fs.stat(absolute);
  if (!stat.isFile() || stat.size > MAX_PREVIEW_IMAGE_BYTES) return null;
  const bytes = await fs.readFile(absolute);
  return `data:${mime};base64,${bytes.toString('base64')}`;
}
