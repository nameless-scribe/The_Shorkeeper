import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await import('./prepare-dist-assets.mjs');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.equal(packageJson.build.win.icon, 'build/icon.ico');

const icon = fs.readFileSync(path.join(root, 'build', 'icon.ico'));
assert.equal(icon.readUInt16LE(0), 0);
assert.equal(icon.readUInt16LE(2), 1);
const sizes = [16, 32, 48, 64, 128, 256];
assert.equal(icon.readUInt16LE(4), sizes.length);
for (let index = 0; index < sizes.length; index += 1) {
  const entry = 6 + index * 16;
  const size = sizes[index];
  assert.equal(icon.readUInt8(entry), size === 256 ? 0 : size);
  assert.equal(icon.readUInt8(entry + 1), size === 256 ? 0 : size);
  const bytes = icon.readUInt32LE(entry + 8);
  const offset = icon.readUInt32LE(entry + 12);
  assert(bytes > 0 && offset + bytes <= icon.length);
  assert.equal(icon.subarray(offset, offset + 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(icon.readUInt32BE(offset + 16), size);
  assert.equal(icon.readUInt32BE(offset + 20), size);
}
console.log('Windows 打包图标验证通过：6 个尺寸均为有效 PNG 图层');
