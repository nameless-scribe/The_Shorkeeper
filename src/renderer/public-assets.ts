/** public/ 静态资源绝对 URL，兼容 Electron file:// 与 dev server */
export function publicAssetUrl(filename: string): string {
  if (typeof window !== 'undefined' && window.location?.href) {
    return new URL(filename, window.location.href).href;
  }
  const base = import.meta.env.BASE_URL;
  return `${base}${filename}`;
}

export const KEEPER_AVATAR_URL = publicAssetUrl('keeper-avatar.png');
export const USER_AVATAR_URL = publicAssetUrl('user-avatar.png');
export const TETHYS_EMBLEM_URL = publicAssetUrl('tethys-emblem.png');
