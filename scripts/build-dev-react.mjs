import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * 用 React 的 **development** 构建产出一份 dist/，供 StrictMode 严格模式 UI 冒烟使用。
 *
 * 为什么不是 `vite build --mode development`：mode 只影响 `.env` 加载与 `import.meta.env.MODE`，
 * React 走的是 package exports 的 development / production 条件，由 NODE_ENV 决定。
 * 实测 `--mode development` 产出的 index 包仍是 151K 的 production React；
 * 设置 NODE_ENV=development 后是 336K，且带上了 StrictMode 双调用与各类开发期告警。
 *
 * 用 node 包装而不是在 npm script 里写 `NODE_ENV=development vite build`：
 * 后者在 PowerShell / cmd 下不成立，而本仓库以 Windows 为主路径。
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...env },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('node', ['scripts/copy-vad-assets.mjs']);
run('npx', ['vite', 'build'], { NODE_ENV: 'development' });

console.warn(
  '\n[build:dev-react] dist/ 与 dist-electron/ 现在是 **开发版** 产物（React development build）。\n' +
    '[build:dev-react] 只用于 pnpm test:ui:strict；打包或发布前请重新执行 pnpm build。\n',
);
