import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from 'electron';

/** 与 main.js、preload.mjs 同级的 dist-electron 目录 */
const electronDist = path.dirname(fileURLToPath(import.meta.url));

export function getPreloadPath(): string {
  return path.join(electronDist, 'preload.mjs');
}

export function getRendererIndexPath(): string {
  return path.join(electronDist, '../dist/index.html');
}

/** 渲染层构建产物（public/ → dist/）中的静态资源 */
export function getDistAssetPath(filename: string): string {
  return path.join(electronDist, '../dist', filename);
}

/** 生产包中 dist 静态资源；优先 app.asar.unpacked（asarUnpack 后供 nativeImage 读取） */
export function resolvePackagedDistAsset(filename: string): string | undefined {
  const candidates: string[] = [];

  if (app.isPackaged) {
    const asarDir = path.dirname(app.getAppPath());
    candidates.push(path.join(asarDir, 'app.asar.unpacked', 'dist', filename));
    candidates.push(path.join(app.getAppPath(), 'dist', filename));
  }

  candidates.push(
    getDistAssetPath(filename),
    path.join(app.getAppPath(), 'dist', filename),
    path.join(process.cwd(), 'dist', filename),
    path.join(process.cwd(), 'public', filename),
  );

  for (const file of candidates) {
    if (fs.existsSync(file)) return file;
  }
  return undefined;
}
