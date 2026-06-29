import type { ReactNode } from 'react';

function isElectronRuntime(): boolean {
  return navigator.userAgent.includes('Electron');
}

export function RuntimeGate({ children }: { children: ReactNode }) {
  if (window.shorekeeper) {
    return <>{children}</>;
  }

  if (isElectronRuntime()) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-gradient-to-b from-shore-bg to-shore-panel p-8 text-center text-white">
        <h1 className="text-lg font-semibold">The Shorekeeper</h1>
        <p className="max-w-xs text-sm text-amber-200/90">
          Electron 已启动，但 Preload 未加载成功。
        </p>
        <p className="max-w-xs text-xs text-white/50">
          请完全退出后重新运行 <code className="text-shore-accent">pnpm dev</code>，并查看终端是否有 Preload 报错。
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 bg-gradient-to-b from-shore-bg to-shore-panel p-8 text-center text-white">
      <h1 className="text-lg font-semibold">The Shorekeeper</h1>
      <p className="max-w-xs text-sm text-white/70">
        这是浏览器页面。请关闭此标签，使用 <code className="text-shore-accent">pnpm dev</code> 弹出的
        <strong className="text-white"> 独立桌面窗口 </strong>
        （任务栏里找 The Shorekeeper）。
      </p>
      <p className="text-xs text-white/45">不要手动打开 localhost 地址。</p>
    </div>
  );
}
