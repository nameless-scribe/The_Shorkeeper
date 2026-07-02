import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(root, 'build');
const emblem = path.join(root, 'public', 'tethys-emblem.png');
const iconOut = path.join(buildDir, 'icon.png');

if (!fs.existsSync(emblem)) {
  console.error('[prepare-dist] 缺少 public/tethys-emblem.png，无法生成打包图标');
  process.exit(1);
}

fs.mkdirSync(buildDir, { recursive: true });
fs.copyFileSync(emblem, iconOut);
console.info(`[prepare-dist] 已同步打包图标 -> ${path.relative(root, iconOut)}`);
