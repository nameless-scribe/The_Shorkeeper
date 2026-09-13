import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ProactiveEventDomain,
  ProactiveEventKind,
  ProactiveEventUrgency,
  ProactiveInboxItemInfo,
  ProactiveInboxSection,
  ProactiveInboxSnapshot,
  ProactiveSourceTarget,
  ProactivityRoute,
} from '@/shared/types';
import { EVENT_DOMAIN_LABELS, EVENT_KIND_LABELS, SNOOZE_PRESETS_MINUTES } from '@/proactivity/contract';

export const SECTION_LABELS: Record<ProactiveInboxSection, string> = {
  attention: '需要处理',
  later: '稍后',
  handled: '已处理',
};

export const URGENCY_LABELS: Record<ProactiveEventUrgency, string> = {
  high: '紧急',
  normal: '普通',
  low: '低',
};

export const ROUTE_LABELS: Record<ProactivityRoute, string> = {
  inbox: '进入收件箱',
  notify: '已弹窗提醒',
  defer: '安静时段后提醒',
  suppress: '未弹窗',
};

export const SNOOZE_LABELS: Record<number, string> = {
  30: '30 分钟',
  120: '2 小时',
  1440: '明天',
  4320: '3 天后',
};

export function formatRelativeTime(ms: number, now = Date.now()): string {
  const diff = now - ms;
  if (diff < 0) {
    const ahead = -diff;
    const minutes = Math.round(ahead / 60_000);
    if (minutes < 60) return `${Math.max(1, minutes)} 分钟后`;
    const hours = Math.round(ahead / 3_600_000);
    if (hours < 24) return `${hours} 小时后`;
    return `${Math.round(ahead / 86_400_000)} 天后`;
  }
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return new Date(ms).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

/** 卡片副标题：来源域、类型、发生时间、紧急度、是否被延后 —— 不暴露内部规则或敏感正文。 */
export function formatInboxItemMeta(item: ProactiveInboxItemInfo, now = Date.now()): string {
  const { event } = item;
  const parts = [
    `${EVENT_DOMAIN_LABELS[event.domain]} · ${EVENT_KIND_LABELS[event.kind]}`,
    formatRelativeTime(event.occurredAt, now),
    URGENCY_LABELS[event.urgency],
  ];
  if (event.status === 'snoozed' && event.snoozedUntil != null) {
    parts.push(`稍后：${formatRelativeTime(event.snoozedUntil, now)}`);
  } else if (item.deferredUntil != null) {
    parts.push(`延后到 ${formatRelativeTime(item.deferredUntil, now)}`);
  } else if (item.deliveredAt != null) {
    parts.push('已弹窗');
  }
  if (event.status === 'resolved') {
    parts.push(event.resolvedReason?.startsWith('source:') ? '来源已解决' : '已完成');
  } else if (event.status === 'dismissed') {
    parts.push('已忽略');
  }
  return parts.join(' · ');
}

/** "为什么出现"一句话：由类型决定，不依赖内部路由原因。 */
export function describeWhy(kind: ProactiveEventKind): string {
  switch (kind) {
    case 'task_due_today':
      return '因为这条待办今天截止。';
    case 'task_overdue':
      return '因为这条待办已经过了截止日期。';
    case 'commitment_due_soon':
      return '因为这条承诺 24 小时内到期。';
    case 'commitment_missed':
      return '因为晚间复盘把这条承诺标为错过。';
    case 'commitment_proposed':
      return '因为对话里识别出一条尚未确认的承诺。';
    case 'commitment_unattended':
      return '因为这条承诺超过 7 天没有跟进。';
    case 'run_error':
      return '因为一次运行以错误结束，且你还没有确认。';
    case 'run_interrupted':
      return '因为一次运行被中断，且你还没有确认。';
    case 'schedule_failed':
      return '因为定时任务最近一次执行失败。';
    case 'schedule_missed':
      return '因为一次性提醒没有按时执行。';
    case 'document_changed':
      return '因为本地文件比知识库里的版本新。';
    case 'document_missing':
      return '因为知识库找不到来源文件了。';
    case 'document_sync_failed':
      return '因为文档来源检查或索引失败。';
    case 'memory_conflict':
      return '因为新识别的事实与已有记忆冲突。';
    case 'memory_sensitive':
      return '因为识别到敏感或私密的个人事实，需要你确认。';
    case 'memory_expiring':
      return '因为这条记忆即将到期。';
    case 'goal_target_near':
      return '因为目标日期临近但仍有未完成事项。';
    case 'goal_stalled':
      return '因为这个目标已经两周没有任何进展。';
    default:
      return '';
  }
}

export const DOMAIN_ORDER: ProactiveEventDomain[] = ['commitment', 'task', 'run', 'schedule', 'goal', 'document', 'memory'];

export function countBySection(snapshot: ProactiveInboxSnapshot | null): Record<ProactiveInboxSection, number> {
  return {
    attention: snapshot?.attention.length ?? 0,
    later: snapshot?.later.length ?? 0,
    handled: snapshot?.handled.length ?? 0,
  };
}

interface ProactiveInboxPanelProps {
  open: boolean;
  onOpenSource: (target: ProactiveSourceTarget) => void;
  onUnreadChange?: (count: number) => void;
}

export function ProactiveInboxPanel({ open, onOpenSource, onUnreadChange }: ProactiveInboxPanelProps) {
  const [snapshot, setSnapshot] = useState<ProactiveInboxSnapshot | null>(null);
  const [section, setSection] = useState<ProactiveInboxSection>('attention');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [snoozeFor, setSnoozeFor] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await window.shorekeeper.proactivity.inbox();
      setSnapshot(next);
      setError(null);
      onUnreadChange?.(next.unreadCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取收件箱失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [onUnreadChange]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    void load();
    const off = window.shorekeeper.proactivity.onUpdated(() => {
      void load();
    });
    return () => off();
  }, [open, load]);

  const counts = useMemo(() => countBySection(snapshot), [snapshot]);
  const items = snapshot ? snapshot[section] : [];

  const run = async (id: string, action: () => Promise<unknown>) => {
    if (busyId) return;
    setBusyId(id);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败，请重试');
    } finally {
      setBusyId(null);
      setSnoozeFor(null);
    }
  };

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const next = await window.shorekeeper.proactivity.refresh();
      setSnapshot(next);
      setError(null);
      onUnreadChange?.(next.unreadCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : '刷新失败，请重试');
    } finally {
      setRefreshing(false);
    }
  };

  const handleClearHandled = async () => {
    if (clearing) return;
    if (!window.confirm('清除全部已处理的提示？这不会影响待办、承诺或运行记录。')) return;
    setClearing(true);
    try {
      await window.shorekeeper.proactivity.clearHandled();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '清理失败，请重试');
    } finally {
      setClearing(false);
    }
  };

  const handleExpand = (item: ProactiveInboxItemInfo) => {
    const next = expandedId === item.event.id ? null : item.event.id;
    setExpandedId(next);
    if (next && item.event.readAt == null && item.event.status === 'open') {
      void window.shorekeeper.proactivity.markRead(item.event.id).then(() => load()).catch(console.error);
    }
  };

  const handleOpenSource = (item: ProactiveInboxItemInfo) =>
    run(item.event.id, async () => {
      const target = await window.shorekeeper.proactivity.openSource(item.event.id);
      if (target) onOpenSource(target);
    });

  if (!open) return null;

  return (
    <aside
      className="no-drag flex w-64 shrink-0 flex-col border-r border-keeper-cyan/15 bg-keeper-navyDeep/75 backdrop-blur-md"
      aria-label="主动收件箱"
      data-testid="proactive-inbox"
    >
      <div className="shrink-0 space-y-2 border-b border-keeper-cyan/10 px-3 py-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold text-keeper-ice/80">主动收件箱</h2>
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            className="rounded-lg px-1.5 py-0.5 text-[10px] text-keeper-ice/60 hover:bg-keeper-cyan/10 hover:text-keeper-cyan disabled:opacity-50"
            title="重新检查本地状态"
          >
            {refreshing ? '检查中…' : '刷新'}
          </button>
        </div>
        <div className="flex gap-1" role="tablist" aria-label="收件箱分区">
          {(Object.keys(SECTION_LABELS) as ProactiveInboxSection[]).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={section === key}
              onClick={() => setSection(key)}
              className={`flex-1 rounded-lg px-1 py-1 text-[10px] transition ${
                section === key
                  ? 'bg-keeper-cyan/20 text-keeper-cyan'
                  : 'text-keeper-ice/55 hover:bg-white/5 hover:text-keeper-ice'
              }`}
            >
              {SECTION_LABELS[key]}
              {counts[key] > 0 ? ` ${counts[key]}` : ''}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {error && (
          <div className="mb-2 rounded-lg border border-red-400/30 bg-red-950/40 px-2 py-1.5 text-[10px] text-red-200" role="alert">
            {error}
          </div>
        )}
        {loading ? (
          <p className="px-2 py-3 text-xs text-keeper-ice/50">加载中…</p>
        ) : items.length === 0 ? (
          <p className="px-2 py-3 text-xs text-keeper-ice/50" data-testid="inbox-empty">
            {section === 'attention'
              ? '暂时没有需要处理的提示。'
              : section === 'later'
                ? '没有延后的提示。'
                : '还没有已处理的提示。'}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {items.map((item) => {
              const { event } = item;
              const expanded = expandedId === event.id;
              const busy = busyId === event.id;
              const unread = event.status === 'open' && event.readAt == null;
              return (
                <li key={event.id} data-testid="inbox-item" data-urgency={event.urgency}>
                  <div
                    className={`rounded-xl border px-2.5 py-2 transition ${
                      event.urgency === 'high' && event.status === 'open'
                        ? 'border-amber-300/30 bg-amber-950/20'
                        : 'border-keeper-silver/10 bg-keeper-navy/30'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleExpand(item)}
                      aria-expanded={expanded}
                      className="w-full text-left"
                    >
                      <div className="flex items-start gap-1.5">
                        {unread && (
                          <span
                            className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-keeper-cyan"
                            aria-label="未读"
                          />
                        )}
                        <p className={`min-w-0 flex-1 text-xs ${unread ? 'font-semibold text-keeper-ice' : 'text-keeper-ice/85'}`}>
                          {event.title}
                        </p>
                      </div>
                      <p className="mt-0.5 break-words text-[10px] text-keeper-ice/50">{formatInboxItemMeta(item)}</p>
                    </button>

                    {expanded && (
                      <div className="mt-2 space-y-2 border-t border-keeper-cyan/10 pt-2">
                        <p className="text-[10px] leading-relaxed text-keeper-ice/70">{describeWhy(event.kind)}</p>
                        {event.summary && (
                          <p className="break-words text-[11px] leading-relaxed text-keeper-ice/80">{event.summary}</p>
                        )}
                        {item.lastRoute && (
                          <p className="text-[10px] text-keeper-ice/45">{ROUTE_LABELS[item.lastRoute]}</p>
                        )}
                        <div className="flex flex-wrap gap-1">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleOpenSource(item)}
                            className="rounded-lg bg-keeper-cyan/20 px-2 py-1 text-[10px] text-keeper-cyan hover:bg-keeper-cyan/30 disabled:opacity-50"
                          >
                            处理
                          </button>
                          {(event.status === 'open' || event.status === 'snoozed') && (
                            <>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => setSnoozeFor(snoozeFor === event.id ? null : event.id)}
                                className="rounded-lg border border-keeper-silver/15 px-2 py-1 text-[10px] text-keeper-ice/70 hover:border-keeper-cyan/30 hover:text-keeper-cyan disabled:opacity-50"
                              >
                                稍后
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void run(event.id, () => window.shorekeeper.proactivity.resolve(event.id))
                                }
                                className="rounded-lg border border-keeper-silver/15 px-2 py-1 text-[10px] text-keeper-ice/70 hover:border-keeper-cyan/30 hover:text-keeper-cyan disabled:opacity-50"
                              >
                                已完成
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void run(event.id, () => window.shorekeeper.proactivity.dismiss(event.id, 'not_relevant'))
                                }
                                className="rounded-lg border border-keeper-silver/15 px-2 py-1 text-[10px] text-keeper-ice/60 hover:border-red-400/30 hover:text-red-300 disabled:opacity-50"
                              >
                                忽略
                              </button>
                            </>
                          )}
                        </div>
                        {snoozeFor === event.id && (
                          <div className="flex flex-wrap gap-1" role="group" aria-label="稍后提醒时长">
                            {SNOOZE_PRESETS_MINUTES.map((minutes) => (
                              <button
                                key={minutes}
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void run(event.id, () => window.shorekeeper.proactivity.snooze(event.id, minutes))
                                }
                                className="rounded-lg bg-white/5 px-2 py-0.5 text-[10px] text-keeper-ice/70 hover:bg-keeper-cyan/15 hover:text-keeper-cyan disabled:opacity-50"
                              >
                                {SNOOZE_LABELS[minutes] ?? `${minutes} 分钟`}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {section === 'handled' && counts.handled > 0 && (
        <div className="shrink-0 border-t border-keeper-cyan/10 px-3 py-2">
          <button
            type="button"
            onClick={() => void handleClearHandled()}
            disabled={clearing}
            className="w-full rounded-lg border border-keeper-silver/15 py-1 text-[10px] text-keeper-ice/60 hover:border-keeper-cyan/30 hover:text-keeper-cyan disabled:opacity-50"
          >
            {clearing ? '清理中…' : '清除已处理'}
          </button>
        </div>
      )}
    </aside>
  );
}
