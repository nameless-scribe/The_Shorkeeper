import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TokenUsageSummaryInfo } from '@/shared/types';
import { DAILY_TOKEN_BUDGET } from '@/shared/token-budget';

export function useCallTokenUsage() {
  const [stats, setStats] = useState<TokenUsageSummaryInfo | null>(null);

  const loadStats = useCallback(async () => {
    const data = await window.shorekeeper.stats.getTokenUsage();
    setStats(data);
    return data;
  }, []);

  useEffect(() => {
    loadStats().catch(console.error);

    const off = window.shorekeeper.agent.onEvent((event) => {
      const e = event as { type?: string };
      if (e.type === 'usage' || e.type === 'state_update' || e.type === 'run_finished') {
        loadStats().catch(console.error);
      }
    });

    return () => {
      off();
    };
  }, [loadStats]);

  const today = stats?.today ?? 0;
  const progress = useMemo(
    () => Math.min(100, Math.round((today / DAILY_TOKEN_BUDGET) * 100)),
    [today],
  );
  const overBudget = today >= DAILY_TOKEN_BUDGET;

  return { stats, today, progress, overBudget, loadStats };
}
