import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { getJsonSetting, setJsonSetting } from '../db/app-settings';
import { getAppearanceDir } from './paths';
import type { AppearanceAssetSlot } from '../shared/types';
import { toAppearanceAssetUrl } from '../shared/appearance-asset-url';

const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const MAX_BYTES = 8 * 1024 * 1024;

export interface ThemeAssetsRecord {
  background?: string | null;
  keeperAvatar?: string | null;
  userAvatar?: string | null;
}

const ASSETS_KEY = 'ui.theme.assets';

export function getThemeAssetsRecord(): ThemeAssetsRecord {
  return getJsonSetting<ThemeAssetsRecord>(ASSETS_KEY) ?? {};
}

export function setThemeAssetsRecord(record: ThemeAssetsRecord): void {
  setJsonSetting(ASSETS_KEY, record);
}

export function ensureAppearanceDir(): void {
  const dir = getAppearanceDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function validateSourceFile(sourcePath: string): void {
  const resolved = path.resolve(sourcePath);
  if (!fs.existsSync(resolved)) {
    throw new Error('文件不存在');
  }
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    throw new Error('请选择文件');
  }
  if (stat.size > MAX_BYTES) {
    throw new Error('图片不能超过 8MB');
  }
  const ext = path.extname(resolved).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    throw new Error('仅支持 png、jpg、jpeg、webp');
  }
}

function safeBasename(relativePath: string): string {
  return path.basename(relativePath.replace(/\\/g, '/'));
}

/** 主进程读取磁盘上的外观文件绝对路径 */
export function resolveAppearanceAssetFilePath(
  relativePath: string | null | undefined,
): string | null {
  if (!relativePath?.trim()) return null;

  ensureAppearanceDir();
  const base = path.resolve(getAppearanceDir());
  const abs = path.resolve(base, safeBasename(relativePath));

  if (!abs.startsWith(base + path.sep) && abs !== base) {
    throw new Error('非法资源路径');
  }
  if (!fs.existsSync(abs)) {
    return null;
  }
  return abs;
}

/** 供渲染进程 img / CSS 使用的 URL（sk-asset:// 协议） */
export function resolveAppearanceAssetUrl(relativePath: string | null | undefined): string | null {
  const abs = resolveAppearanceAssetFilePath(relativePath);
  if (!abs) return null;
  return toAppearanceAssetUrl(path.basename(abs));
}

function removeAppearanceFile(relativePath: string | null | undefined): void {
  if (!relativePath?.trim()) return;
  try {
    const filePath = resolveAppearanceAssetFilePath(relativePath);
    if (!filePath) return;
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    /* ignore cleanup errors */
  }
}

function copyAsset(sourcePath: string, prefix: string): string {
  validateSourceFile(sourcePath);
  ensureAppearanceDir();

  const ext = path.extname(sourcePath).toLowerCase();
  const filename = `${prefix}-${uuidv4()}${ext}`;
  const dest = path.join(getAppearanceDir(), filename);
  fs.copyFileSync(path.resolve(sourcePath), dest);

  return filename;
}

export function importBackgroundAsset(sourcePath: string): string {
  const assets = getThemeAssetsRecord();
  const filename = copyAsset(sourcePath, 'bg');
  try {
    setThemeAssetsRecord({ ...assets, background: filename });
  } catch (error) {
    removeAppearanceFile(filename);
    throw error;
  }
  removeAppearanceFile(assets.background ?? null);
  return filename;
}

export function importAvatarAsset(sourcePath: string, slot: 'keeperAvatar' | 'userAvatar'): string {
  const assets = getThemeAssetsRecord();
  const prefix = slot === 'keeperAvatar' ? 'avatar-keeper' : 'avatar-user';
  const filename = copyAsset(sourcePath, prefix);
  try {
    setThemeAssetsRecord({ ...assets, [slot]: filename });
  } catch (error) {
    removeAppearanceFile(filename);
    throw error;
  }
  removeAppearanceFile(assets[slot] ?? null);
  return filename;
}

export function clearAppearanceAsset(slot: AppearanceAssetSlot): void {
  const assets = getThemeAssetsRecord();
  const next = { ...assets };

  if (slot === 'background') {
    removeAppearanceFile(assets.background ?? null);
    next.background = null;
  } else if (slot === 'keeperAvatar') {
    removeAppearanceFile(assets.keeperAvatar ?? null);
    next.keeperAvatar = null;
  } else {
    removeAppearanceFile(assets.userAvatar ?? null);
    next.userAvatar = null;
  }

  setThemeAssetsRecord(next);
}

export function getKeeperAvatarPathForTray(): string | null {
  const assets = getThemeAssetsRecord();
  if (!assets.keeperAvatar) return null;
  try {
    return resolveAppearanceAssetFilePath(assets.keeperAvatar);
  } catch {
    return null;
  }
}
