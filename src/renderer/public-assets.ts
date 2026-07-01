/** public/ 静态资源 URL；配合 vite base: './'，兼容 Electron file:// 加载 */
const base = import.meta.env.BASE_URL;

export const KEEPER_AVATAR_URL = `${base}keeper-avatar.png`;
export const USER_AVATAR_URL = `${base}user-avatar.png`;
