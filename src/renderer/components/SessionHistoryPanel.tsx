import { useCallback, useEffect, useState } from 'react';
import type { SessionInfo } from '@/shared/types';

const MAX_SESSIONS = 50;

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return new Date(ms).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

interface SessionHistoryPanelProps {
  open: boolean;
  currentSessionId: string | null;
  onSelect: (sessionId: string) => void;
  refreshKey?: number;
}

export function SessionHistoryPanel({
  open,
  currentSessionId,
  onSelect,
  refreshKey = 0,
}: SessionHistoryPanelProps) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const list = await window.shorekeeper.sessions.list();
    setSessions(list.slice(0, MAX_SESSIONS));
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    refresh().catch(console.error);
  }, [open, refresh, refreshKey]);

  if (!open) return null;

  return (
    <aside className="no-drag flex w-52 shrink-0 flex-col border-r border-keeper-cyan/15 bg-keeper-navyDeep/75 backdrop-blur-md">
      <div className="shrink-0 border-b border-keeper-cyan/10 px-3 py-2.5">
        <h2 className="text-xs font-semibold text-keeper-ice/80">历史会话</h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {loading ? (
          <p className="px-2 py-3 text-xs text-keeper-ice/50">加载中…</p>
        ) : sessions.length === 0 ? (
          <p className="px-2 py-3 text-xs text-keeper-ice/50">暂无历史</p>
        ) : (
          <ul className="space-y-1">
            {sessions.map((session) => {
              const active = session.id === currentSessionId;
              return (
                <li key={session.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(session.id)}
                    className={`w-full rounded-lg px-2.5 py-2 text-left transition ${
                      active
                        ? 'bg-keeper-cyan/20 text-keeper-cyan'
                        : 'text-keeper-ice/75 hover:bg-white/5 hover:text-keeper-ice'
                    }`}
                  >
                    <p className="truncate text-xs font-medium">{session.title || '新对话'}</p>
                    <p className="mt-0.5 text-[10px] opacity-60">
                      {formatRelativeTime(session.updatedAt)}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
