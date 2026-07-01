import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
