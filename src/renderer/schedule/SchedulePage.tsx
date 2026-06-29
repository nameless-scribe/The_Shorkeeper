import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ScheduledTaskInfo, TokenUsageSummaryInfo } from '@/shared/types';
import { AppBackground } from '../components/AppBackground';
import { PanelTitleBar } from '../components/PanelTitleBar';

const DAILY_TOKEN_BUDGET = 100_000;

function formatDateLabel(): string {
  const d = new Date();
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 · 周${weekdays[d.getDay()]}`;
}

export function SchedulePage() {
  const [stats, setStats] = useState<TokenUsageSummaryInfo | null>(null);
  const [tasks, setTasks] = useState<ScheduledTaskInfo[]>([]);
  const [chartKey, setChartKey] = useState(0);

  const loadData = useCallback(async () => {
    const [tokenStats, taskList] = await Promise.all([
      window.shorekeeper.stats.getTokenUsage(),
      window.shorekeeper.tasks.list(),
    ]);
    setStats(tokenStats);
    setTasks(taskList);
    setChartKey((k) => k + 1);
  }, []);

  useEffect(() => {
    loadData().catch(console.error);

    const offAgent = window.shorekeeper.agent.onEvent((event) => {
      const e = event as { type?: string };
      if (e.type === 'usage' || e.type === 'state_update' || e.type === 'run_finished') {
        loadData().catch(console.error);
      }
    });

    const onFocus = () => {
      loadData().catch(console.error);
    };
    window.addEventListener('focus', onFocus);

    return () => {
      offAgent();
      window.removeEventListener('focus', onFocus);
    };
  }, [loadData]);

  const progress = useMemo(() => {
    if (!stats) return 0;
    return Math.min(100, Math.round((stats.today / DAILY_TOKEN_BUDGET) * 100));
  }, [stats]);

  const chartData = stats?.dailyLast7 ?? [];

  return (
    <div className="relative h-screen overflow-hidden rounded-3xl border border-keeper-silver/25 shadow-cyanSm">
      <AppBackground />

      <div className="relative z-10 flex h-full min-h-0 flex-col">
        <PanelTitleBar title="日程 & Token" subtitle={formatDateLabel()} />

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <section className="keeper-glass-soft rounded-2xl p-4">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-xs text-keeper-ice/60">今日 Token</p>
                <p className="text-2xl font-semibold text-keeper-cyan">
                  {(stats?.today ?? 0).toLocaleString()}
                </p>
              </div>
              <div className="text-right text-xs text-keeper-ice/50">
                <p>本周 {(stats?.week ?? 0).toLocaleString()}</p>
                <p>累计 {(stats?.total ?? 0).toLocaleString()}</p>
              </div>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-keeper-navyDeep/80">
              <div
                className="h-full rounded-full bg-gradient-to-r from-keeper-navy to-keeper-cyan transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="mt-1 text-[10px] text-keeper-ice/40">
              日预算参考 {DAILY_TOKEN_BUDGET.toLocaleString()} · {progress}%
            </p>
          </section>

          <section className="keeper-glass-soft rounded-2xl p-3">
            <p className="mb-2 text-xs font-medium text-keeper-ice/70">近 7 日 Token</p>
            <div className="h-40 w-full min-w-0">
              <ResponsiveContainer key={chartKey} width="100%" height="100%" minWidth={0}>
                <BarChart data={chartData}>
                  <XAxis
                    dataKey="date"
                    tick={{ fill: 'rgba(225,233,240,0.5)', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: 'rgba(225,233,240,0.4)', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    width={36}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'rgba(10,17,40,0.92)',
                      border: '1px solid rgba(48,188,237,0.25)',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    labelStyle={{ color: '#E1E9F0' }}
                  />
                  <Bar dataKey="tokens" fill="#30BCED" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="keeper-glass-soft rounded-2xl p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-medium text-keeper-ice/70">定时任务</p>
              <button
                type="button"
                onClick={() => window.shorekeeper.window.openSettings()}
                className="no-drag text-[10px] text-keeper-cyan hover:underline"
              >
                任务设置 →
              </button>
            </div>
            {tasks.length === 0 ? (
              <p className="text-xs text-keeper-ice/40">暂无任务，可在设置中添加</p>
            ) : (
              <ul className="space-y-2">
                {tasks.map((task) => (
                  <li
                    key={task.id}
                    className="flex items-center justify-between rounded-xl border border-keeper-silver/10 bg-white/5 px-3 py-2"
                  >
                    <div>
                      <p className="text-xs font-medium text-keeper-ice">{task.name}</p>
                      <p className="text-[10px] text-keeper-ice/40">{task.cron}</p>
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] ${
                        task.enabled
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : 'bg-gray-500/15 text-gray-400'
                      }`}
                    >
                      {task.enabled ? '启用' : '停用'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
