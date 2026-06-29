import type { AppStatus } from '@/shared/types';

interface TitleBarProps {
  status: AppStatus | null;
  onOpenSettings?: () => void;
}

export function TitleBar({ status, onOpenSettings }: TitleBarProps) {
  return (
    <header className="drag-region keeper-glass-panel flex shrink-0 items-center justify-between border-b border-keeper-cyan/15 px-4 py-3">
      <div className="no-drag">
        <h1 className="text-sm font-semibold tracking-wide text-keeper-ice">
          The Shorekeeper
        </h1>
        <p className="text-xs text-keeper-ice/60">
          {status?.apiConfigured ? (
            <>
              <span className="text-keeper-cyan drop-shadow-[0_0_6px_rgba(0,212,255,0.8)]">◆</span>{' '}
              {status.model} 已连接
            </>
          ) : (
            <span className="text-amber-300/90">未配置 API Key</span>
          )}
        </p>
      </div>
      <div className="no-drag flex gap-1">
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-keeper-ice/50 hover:bg-keeper-cyan/10 hover:text-keeper-cyan"
          title="设置"
        >
          ⚙
        </button>
        <button
          type="button"
          onClick={() => window.shorekeeper.window.minimize()}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-keeper-ice/50 hover:bg-keeper-cyan/10 hover:text-keeper-cyan"
          title="最小化"
        >
          ─
        </button>
        <button
          type="button"
          onClick={() => window.shorekeeper.window.close()}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-keeper-ice/50 hover:bg-red-500/20 hover:text-red-300"
          title="关闭"
        >
          ✕
        </button>
      </div>
    </header>
  );
}
