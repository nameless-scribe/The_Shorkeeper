/** 渲染进程加载外观资源用的自定义协议（避免 file:// 读 asar / 解包目录失败） */
export const APPEARANCE_ASSET_SCHEME = 'sk-asset';

export type AppearanceAssetScope = 'local' | 'dist';

const SAFE_FILENAME = /^[\w.-]+$/;
const DIST_EXTENSIONS = new Set(['.png', '.svg', '.jpg', '.jpeg', '.webp', '.ico']);

function safeBasename(filename: string): string {
  return filename.replace(/\\/g, '/').split('/').pop() ?? filename;
}

export function toAppearanceAssetUrl(
  filename: string,
  scope: AppearanceAssetScope = 'local',
): string {
  const safe = safeBasename(filename);
  return `${APPEARANCE_ASSET_SCHEME}://${scope}/${encodeURIComponent(safe)}`;
}

export function parseAppearanceAssetUrl(
  url: string,
): { scope: AppearanceAssetScope; filename: string } | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== `${APPEARANCE_ASSET_SCHEME}:`) return null;
    const scope = parsed.hostname;
    if (scope !== 'local' && scope !== 'dist') return null;
    const name = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
    if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) {
      return null;
    }
    if (scope === 'dist') {
      if (!SAFE_FILENAME.test(name)) return null;
      const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '';
      if (!DIST_EXTENSIONS.has(ext)) return null;
    }
    return { scope, filename: name };
  } catch {
    return null;
  }
}

/** 仅解析用户外观目录（sk-asset://local/...） */
export function parseAppearanceAssetFilename(url: string): string | null {
  const parsed = parseAppearanceAssetUrl(url);
  return parsed?.scope === 'local' ? parsed.filename : null;
}
