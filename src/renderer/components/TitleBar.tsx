import type { AppStatus } from '@/shared/types';

interface TitleBarProps {
  status: AppStatus | null;
}

export function TitleBar({ status }: TitleBarProps) {
  return (
    <header className="drag-region flex items-center justify-between border-b border-white/10 px-4 py-3">
      <div className="no-drag">
        <h1 className="text-sm font-semibold text-white">The Shorekeeper</h1>
        <p className="text-xs text-white/50">
          {status?.apiConfigured ? (
            <>
              <span className="text-emerald-400">●</span> {status.model} 已连接
            </>
          ) : (
            <span className="text-amber-400">未配置 API Key</span>
          )}
        </p>
      </div>
      <div className="no-drag flex gap-1">
        <button
          type="button"
          onClick={() => window.shorekeeper.window.minimize()}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-white/60 hover:bg-white/10"
          title="最小化"
        >
          ─
        </button>
        <button
          type="button"
          onClick={() => window.shorekeeper.window.close()}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-white/60 hover:bg-red-500/30 hover:text-red-200"
          title="关闭"
        >
          ✕
        </button>
      </div>
    </header>
  );
}
