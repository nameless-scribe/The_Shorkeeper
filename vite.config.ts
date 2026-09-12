import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';

const hasWindowsSigningCertificate = Boolean(
  process.env.WIN_CSC_LINK || process.env.CSC_LINK,
);

const isExternal = (id: string) =>
  id === 'electron' ||
  id === 'electron-updater' ||
  id.startsWith('electron-updater/') ||
  id === 'sql.js' ||
  id === 'node-cron' ||
  id === 'ws' ||
  id === 'docx' ||
  id === 'exceljs' ||
  id === 'mammoth' ||
  id === 'word-extractor' ||
  id === 'pdf-parse' ||
  id.startsWith('pdf-parse/') ||
  id === 'pdfjs-dist' ||
  id.startsWith('pdfjs-dist/') ||
  id === '@napi-rs/canvas' ||
  id.startsWith('@napi-rs/canvas') ||
  id === 'pdf-lib' ||
  id.startsWith('@modelcontextprotocol/') ||
  id.startsWith('node:') ||
  id.startsWith('sql.js/');

export default defineConfig({
  // Electron 生产环境用 loadFile(file://)，须相对路径加载 public 资源
  base: './',
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          define: {
            __SIGNED_UPDATE_BUILD__: JSON.stringify(hasWindowsSigningCertificate),
          },
          build: {
            emptyOutDir: true,
            rollupOptions: {
              external: isExternal,
              output: { inlineDynamicImports: true },
            },
          },
        },
      },
      preload: {
        input: path.join(__dirname, 'electron/preload.ts'),
        vite: {
          build: {
            rollupOptions: {
              external: isExternal,
            },
          },
        },
      },
      renderer: {},
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  clearScreen: false,
});
