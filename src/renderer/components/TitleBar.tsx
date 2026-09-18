import type { AppStatus, AssistantMode } from '@/shared/types';
import { useWindowDrag } from '../hooks/useWindowDrag';
import { AssistantModeSwitcher } from './AssistantModeSwitcher';

interface TitleBarProps {
  status: AppStatus | null;
  assistantMode: AssistantMode;
  assistantModeDisabled?: boolean;
  onAssistantModeChange: (mode: AssistantMode) => void;
  onOpenSettings?: () => void;
  onNewChat?: () => void;
  onToggleHistory?: () => void;
  onOpenCall?: () => void;
  historyOpen?: boolean;
  onToggleInbox?: () => void;
  inboxOpen?: boolean;
  inboxUnread?: number;
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
  assistantMode,
  assistantModeDisabled,
  onAssistantModeChange,
  onOpenSettings,
  onNewChat,
  onToggleHistory,
  onOpenCall,
  historyOpen,
  onToggleInbox,
  inboxOpen,
  inboxUnread = 0,
}: TitleBarProps) {
  const drag = useWindowDrag();

  return (
    <header
      className="keeper-glass-panel flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-t-3xl border-b border-keeper-cyan/15 px-4 py-3"
      {...drag}
    >
      <div className="min-w-0 w-full sm:w-auto sm:flex-1">
        <h1 className="text-sm font-semibold tracking-wide text-keeper-ice">
          The Shorekeeper
        </h1>
        <p className="truncate text-xs text-keeper-ice/60" title={status?.apiConfigured ? `${formatConnectionLabel(status)} 已连接` : '未配置 API Key'}>
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

      <div className="no-drag flex shrink-0 items-center gap-2">
        <AssistantModeSwitcher
          value={assistantMode}
          disabled={assistantModeDisabled}
          onChange={onAssistantModeChange}
        />
        <div className="flex gap-1">
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
            onClick={onToggleInbox}
            className={`relative flex h-7 w-7 items-center justify-center rounded-lg ${
              inboxOpen
                ? 'bg-keeper-cyan/20 text-keeper-cyan'
                : 'text-keeper-ice/50 hover:bg-keeper-cyan/10 hover:text-keeper-cyan'
            }`}
            title="主动收件箱"
            aria-label={inboxUnread > 0 ? `主动收件箱，${inboxUnread} 条未读` : '主动收件箱'}
          >
            ◎
            {inboxUnread > 0 && (
              <span
                className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-keeper-cyan px-1 text-[9px] font-semibold leading-none text-keeper-navyDeep"
                data-testid="inbox-unread-badge"
              >
                {inboxUnread > 99 ? '99+' : inboxUnread}
              </span>
            )}
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
            onClick={onOpenCall}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-keeper-ice/50 hover:bg-keeper-cyan/10 hover:text-keeper-cyan"
            title="语音通话"
          >
            📞
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
      </div>
    </header>
  );
}
