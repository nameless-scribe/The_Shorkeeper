import { toAppearanceAssetUrl } from '../shared/appearance-asset-url';

/** 内置 public/ 资源走 sk-asset://dist，安装包里不依赖 asar 的 file:// 相对路径 */
export function publicAssetUrl(filename: string): string {
  return toAppearanceAssetUrl(filename, 'dist');
}

export const KEEPER_AVATAR_URL = publicAssetUrl('keeper-avatar.png');
export const USER_AVATAR_URL = publicAssetUrl('user-avatar.png');
export const TETHYS_EMBLEM_URL = publicAssetUrl('tethys-emblem.png');
