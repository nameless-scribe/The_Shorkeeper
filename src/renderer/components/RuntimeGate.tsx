import type { ReactNode } from 'react';
import { AppBackground } from './AppBackground';

function isElectronRuntime(): boolean {
  return navigator.userAgent.includes('Electron');
}

export function RuntimeGate({ children }: { children: ReactNode }) {
  if (window.shorekeeper) {
    return <>{children}</>;
  }

  const shell = (body: ReactNode) => (
    <div className="relative h-screen overflow-hidden rounded-3xl">
      <AppBackground />
      <div className="relative z-10 flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        {body}
      </div>
    </div>
  );

  if (isElectronRuntime()) {
    return shell(
      <>
        <h1 className="text-lg font-semibold text-keeper-ice">The Shorekeeper</h1>
        <p className="max-w-xs text-sm text-amber-200/90">Preload 未加载成功，请重启 pnpm dev。</p>
      </>,
    );
  }

  return shell(
    <>
      <h1 className="text-lg font-semibold text-keeper-ice">The Shorekeeper</h1>
      <p className="max-w-xs text-sm text-keeper-ice/60">
        请使用 <code className="font-mono text-keeper-cyan">pnpm dev</code> 弹出的桌面窗口。
      </p>
    </>,
  );
}
