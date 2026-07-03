import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public', 'vad');
const vadDist = path.join(root, 'node_modules', '@ricky0123', 'vad-web', 'dist');
const ortDist = path.join(root, 'node_modules', 'onnxruntime-web', 'dist');

/** Minimal set for Electron renderer (numThreads=1); dev and prod share the same files. */
const REQUIRED_FILES = [
  { src: path.join(vadDist, 'vad.worklet.bundle.min.js'), name: 'vad.worklet.bundle.min.js' },
  { src: path.join(vadDist, 'silero_vad_legacy.onnx'), name: 'silero_vad_legacy.onnx' },
  { src: path.join(vadDist, 'silero_vad_v5.onnx'), name: 'silero_vad_v5.onnx' },
  { src: path.join(ortDist, 'ort-wasm-simd-threaded.mjs'), name: 'ort-wasm-simd-threaded.mjs' },
  { src: path.join(ortDist, 'ort-wasm-simd-threaded.wasm'), name: 'ort-wasm-simd-threaded.wasm' },
];

function copyIfExists(src, dest) {
  if (!fs.existsSync(src)) {
    console.warn(`[copy-vad-assets] skip missing: ${path.relative(root, src)}`);
    return false;
  }
  fs.copyFileSync(src, dest);
  return true;
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

let copied = 0;
const missing = [];

for (const { src, name } of REQUIRED_FILES) {
  const dest = path.join(outDir, name);
  if (copyIfExists(src, dest)) {
    copied += 1;
  } else {
    missing.push(name);
  }
}

if (missing.length > 0) {
  console.error(`[copy-vad-assets] missing required files: ${missing.join(', ')}`);
  console.error('[copy-vad-assets] run pnpm install and retry');
  process.exit(1);
}

console.info(`[copy-vad-assets] synced ${copied} files -> public/vad/`);
