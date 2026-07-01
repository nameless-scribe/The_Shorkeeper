/** 渲染进程加载用户外观资源用的自定义协议（避免 http 页面无法读 file://） */
export const APPEARANCE_ASSET_SCHEME = 'sk-asset';

export function toAppearanceAssetUrl(filename: string): string {
  const safe = filename.replace(/\\/g, '/').split('/').pop() ?? filename;
  return `${APPEARANCE_ASSET_SCHEME}://local/${encodeURIComponent(safe)}`;
}

export function parseAppearanceAssetFilename(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== `${APPEARANCE_ASSET_SCHEME}:`) return null;
    if (parsed.hostname !== 'local') return null;
    const name = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
    if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) {
      return null;
    }
    return name;
  } catch {
    return null;
  }
}
