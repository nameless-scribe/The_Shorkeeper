import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public', 'vad');
const vadDist = path.join(root, 'node_modules', '@ricky0123', 'vad-web', 'dist');
const ortDist = path.join(root, 'node_modules', 'onnxruntime-web', 'dist');

const vadFiles = [
  'vad.worklet.bundle.min.js',
  'silero_vad_legacy.onnx',
  'silero_vad_v5.onnx',
];

function copyIfExists(src, dest) {
  if (!fs.existsSync(src)) {
    console.warn(`[copy-vad-assets] skip missing: ${path.relative(root, src)}`);
    return false;
  }
  fs.copyFileSync(src, dest);
  return true;
}

fs.mkdirSync(outDir, { recursive: true });

let copied = 0;
for (const name of vadFiles) {
  if (copyIfExists(path.join(vadDist, name), path.join(outDir, name))) copied += 1;
}

if (fs.existsSync(ortDist)) {
  for (const name of fs.readdirSync(ortDist)) {
    if (/^ort-wasm.*\.(mjs|wasm)$/i.test(name)) {
      if (copyIfExists(path.join(ortDist, name), path.join(outDir, name))) copied += 1;
    }
  }
} else {
  console.warn('[copy-vad-assets] onnxruntime-web dist not found — run pnpm install');
}

console.info(`[copy-vad-assets] synced ${copied} files -> public/vad/`);
