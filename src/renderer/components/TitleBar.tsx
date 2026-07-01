import type { AppStatus } from '@/shared/types';

interface TitleBarProps {
  status: AppStatus | null;
  onOpenSettings?: () => void;
  onNewChat?: () => void;
  onToggleHistory?: () => void;
  historyOpen?: boolean;
}

function formatConnectionLabel(status: AppStatus): string {
  const { model, profileName } = status;
  if (profileName && profileName !== model) {
    return `${profileName} · ${model}`;
  }
  return model;
}

export function TitleBar({
  status,
  onOpenSettings,
  onNewChat,
  onToggleHistory,
  historyOpen,
}: TitleBarProps) {
  return (
    <header className="drag-region keeper-glass-panel flex shrink-0 items-center justify-between border-b border-keeper-cyan/15 px-4 py-3">
      <div className="no-drag min-w-0">
        <h1 className="text-sm font-semibold tracking-wide text-keeper-ice">
          The Shorekeeper
        </h1>
        <p className="text-xs text-keeper-ice/60">
          {status?.apiConfigured ? (
            <>
              <span className="text-keeper-cyan drop-shadow-accent">◆</span>{' '}
              {formatConnectionLabel(status)} 已连接
            </>
          ) : (
            <span className="text-amber-300/90">未配置 API Key</span>
          )}
        </p>
      </div>

      <div className="no-drag flex shrink-0 gap-1">
        <button
          type="button"
          onClick={onToggleHistory}
          className={`flex h-7 w-7 items-center justify-center rounded-lg ${
            historyOpen
              ? 'bg-keeper-cyan/20 text-keeper-cyan'
              : 'text-keeper-ice/50 hover:bg-keeper-cyan/10 hover:text-keeper-cyan'
          }`}
          title="历史会话"
        >
          ☰
        </button>
        <button
          type="button"
          onClick={onNewChat}
          className="flex h-7 items-center rounded-lg px-2 text-xs text-keeper-ice/60 hover:bg-keeper-cyan/10 hover:text-keeper-cyan"
          title="新对话"
        >
          ＋
        </button>
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
