import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(root, 'build');
const emblem = path.join(root, 'public', 'tethys-emblem.png');
const iconOut = path.join(buildDir, 'icon.png');
const icoOut = path.join(buildDir, 'icon.ico');

if (!fs.existsSync(emblem)) {
  console.error('[prepare-dist] 缺少 public/tethys-emblem.png，无法生成打包图标');
  process.exit(1);
}

fs.mkdirSync(buildDir, { recursive: true });
fs.copyFileSync(emblem, iconOut);

// Electron Builder can use a ready-made ICO without invoking its memory-heavy PNG converter.
const source = await loadImage(emblem);
const sizes = [16, 32, 48, 64, 128, 256];
const images = sizes.map((size) => {
  const canvas = createCanvas(size, size);
  const context = canvas.getContext('2d');
  const scale = Math.min(size / source.width, size / source.height);
  const width = Math.round(source.width * scale);
  const height = Math.round(source.height * scale);
  context.drawImage(source, Math.floor((size - width) / 2), Math.floor((size - height) / 2), width, height);
  return canvas.toBuffer('image/png');
});
const directory = Buffer.alloc(6 + sizes.length * 16);
directory.writeUInt16LE(0, 0);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(sizes.length, 4);
let offset = directory.length;
for (let index = 0; index < sizes.length; index += 1) {
  const entry = 6 + index * 16;
  directory.writeUInt8(sizes[index] === 256 ? 0 : sizes[index], entry);
  directory.writeUInt8(sizes[index] === 256 ? 0 : sizes[index], entry + 1);
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(images[index].length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += images[index].length;
}
fs.writeFileSync(icoOut, Buffer.concat([directory, ...images]));
console.info(`[prepare-dist] 已同步打包图标 -> ${path.relative(root, iconOut)}、${path.relative(root, icoOut)}`);
