import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TokenUsageSummaryInfo } from '@/shared/types';

const DAILY_TOKEN_BUDGET = 100_000;

export function DockTokenBar() {
  const [stats, setStats] = useState<TokenUsageSummaryInfo | null>(null);

  const loadStats = useCallback(async () => {
    const data = await window.shorekeeper.stats.getTokenUsage();
    setStats(data);
  }, []);

  useEffect(() => {
    loadStats().catch(console.error);

    const offAgent = window.shorekeeper.agent.onEvent((event) => {
      const e = event as { type?: string };
      if (e.type === 'usage' || e.type === 'state_update' || e.type === 'run_finished') {
        loadStats().catch(console.error);
      }
    });

    return () => {
      offAgent();
    };
  }, [loadStats]);

  const progress = useMemo(() => {
    if (!stats) return 0;
    return Math.min(100, Math.round((stats.today / DAILY_TOKEN_BUDGET) * 100));
  }, [stats]);

  const cacheHint =
    (stats?.todayCached ?? 0) > 0
      ? ` · 缓存 ${stats!.cacheHitRateToday}%`
      : '';

  return (
    <div
      data-dock-action="schedule"
      title={`打开日程面板 · 今日 ${(stats?.today ?? 0).toLocaleString()} tokens${cacheHint} · 按住拖动可移动`}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        void window.shorekeeper.dock.openSchedule();
      }}
      className="flex w-full shrink-0 cursor-grab flex-col gap-0.5 rounded-xl border border-keeper-cyan/20 bg-keeper-navyDeep/75 px-2 py-1.5 backdrop-blur-md transition hover:border-keeper-cyan/35 hover:bg-keeper-navyDeep/90 active:cursor-grabbing"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium tracking-wide text-keeper-cyan/90">今日 Token</span>
        <span className="text-[10px] font-semibold text-keeper-cyan">
          {(stats?.today ?? 0).toLocaleString()}
        </span>
      </div>

      <div className="h-1 overflow-hidden rounded-full bg-keeper-navyDeep/80">
        <div
          className="h-full rounded-full bg-gradient-to-r from-keeper-navy to-keeper-cyan transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>

      {(stats?.today ?? 0) > 0 && (
        <p className="text-[9px] leading-tight text-keeper-ice/45">
          {(stats?.todayCached ?? 0) > 0
            ? `缓存命中 ${stats!.cacheHitRateToday}%`
            : '缓存未命中'}
        </p>
      )}
    </div>
  );
}
