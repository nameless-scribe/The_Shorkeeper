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
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const refresh = useCallback(async () => {
    const list = await window.shorekeeper.sessions.list({
      includeArchived: showArchived,
      query: query.trim() || undefined,
    });
    setSessions(list.slice(0, MAX_SESSIONS));
    setLoading(false);
  }, [query, showArchived]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    refresh().catch(console.error);
  }, [open, refresh, refreshKey]);

  const handleDelete = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('确定删除此会话？消息将无法恢复。')) return;
    await window.shorekeeper.sessions.delete(sessionId);
    if (sessionId === currentSessionId) {
      await window.shorekeeper.sessions.create();
    }
    await refresh();
  };

  const handleArchive = async (sessionId: string, archived: boolean, e: React.MouseEvent) => {
    e.stopPropagation();
    await window.shorekeeper.sessions.archive(sessionId, archived);
    await refresh();
  };

  if (!open) return null;

  return (
    <aside className="no-drag flex w-52 shrink-0 flex-col border-r border-keeper-cyan/15 bg-keeper-navyDeep/75 backdrop-blur-md">
      <div className="shrink-0 space-y-2 border-b border-keeper-cyan/10 px-3 py-2.5">
        <h2 className="text-xs font-semibold text-keeper-ice/80">历史会话</h2>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索标题…"
          className="w-full rounded-lg border border-keeper-silver/15 bg-keeper-navy/40 px-2 py-1 text-xs text-keeper-ice placeholder:text-keeper-ice/40"
        />
        <label className="flex items-center gap-1.5 text-[10px] text-keeper-ice/55">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          显示已归档
        </label>
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
                    className={`group w-full rounded-lg px-2.5 py-2 text-left transition ${
                      active
                        ? 'bg-keeper-cyan/20 text-keeper-cyan'
                        : 'text-keeper-ice/75 hover:bg-white/5 hover:text-keeper-ice'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <p className="truncate text-xs font-medium">{session.title || '新对话'}</p>
                      <span className="flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100">
                        <span
                          role="button"
                          tabIndex={0}
                          title={session.archived ? '取消归档' : '归档'}
                          onClick={(e) => void handleArchive(session.id, !session.archived, e)}
                          className="text-[10px] hover:text-keeper-cyan"
                        >
                          {session.archived ? '↩' : '📦'}
                        </span>
                        <span
                          role="button"
                          tabIndex={0}
                          title="删除"
                          onClick={(e) => void handleDelete(session.id, e)}
                          className="text-[10px] hover:text-red-400"
                        >
                          ✕
                        </span>
                      </span>
                    </div>
                    <p className="mt-0.5 text-[10px] opacity-60">
                      {formatRelativeTime(session.updatedAt)}
                      {session.compressed ? ' · 已压缩' : ''}
                      {session.archived ? ' · 归档' : ''}
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
