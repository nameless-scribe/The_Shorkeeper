import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AgentPresenceState } from '@/shared/types';
import { AppBackground } from '../components/AppBackground';
import { PanelTitleBar } from '../components/PanelTitleBar';
import { AgentAvatar } from '../components/AgentAvatar';

const DAILY_TOKEN_BUDGET = 100_000;

const MOOD_LABELS: Record<AgentPresenceState['mood'], string> = {
  happy: '开心',
  calm: '平静',
  sleepy: '困倦',
  thinking: '思考中',
};

const ACTIVITY_LABELS: Record<AgentPresenceState['activity'], string> = {
  idle: '待机',
  accompanying: '陪伴中',
  feeding: '进食中',
  working: '工作中',
};

const MOOD_ICON: Record<AgentPresenceState['mood'], string> = {
  happy: '✦',
  calm: '◈',
  sleepy: '☾',
  thinking: '◎',
};

const ACTIVITY_ICON: Record<AgentPresenceState['activity'], string> = {
  idle: '◇',
  accompanying: '♡',
  feeding: '🍵',
  working: '⚡',
};

const MOOD_RING: Record<AgentPresenceState['mood'], string> = {
  happy: 'from-amber-300/70 via-keeper-cyan/40 to-amber-200/20',
  calm: 'from-keeper-cyan/70 via-keeper-iceDeep/35 to-keeper-cyan/15',
  sleepy: 'from-violet-400/55 via-indigo-400/25 to-violet-300/10',
  thinking: 'from-keeper-iceDeep/75 via-keeper-cyan/45 to-keeper-navy/20',
};

const DEFAULT_STATE: AgentPresenceState = {
  online: true,
  mood: 'calm',
  activity: 'idle',
  affectionStage: '守望',
  currentModel: '—',
  tokenUsageToday: 0,
};

function StatCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: string;
  icon: string;
  accent: string;
}) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-keeper-ice/12 bg-gradient-to-br from-white/[0.07] to-white/[0.02] p-3 backdrop-blur-md transition hover:border-keeper-cyan/25">
      <div
        className={`pointer-events-none absolute -right-3 -top-3 h-12 w-12 rounded-full bg-gradient-to-br ${accent} opacity-25 blur-xl transition group-hover:opacity-40`}
      />
      <div className="relative flex items-center gap-2.5">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${accent} text-sm shadow-cyanSm`}
        >
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-[10px] tracking-wider text-keeper-ice/45">{label}</p>
          <p className="truncate text-sm font-medium text-keeper-ice">{value}</p>
        </div>
      </div>
    </div>
  );
}

export function StatusPage() {
  const [state, setState] = useState<AgentPresenceState>(DEFAULT_STATE);
  const [feeding, setFeeding] = useState(false);
  const [displayName, setDisplayName] = useState('守岸人');

  useEffect(() => {
    window.shorekeeper.presence.get().then(setState).catch(console.error);
    window.shorekeeper.persona.get().then((p) => setDisplayName(p.displayName)).catch(console.error);

    const off = window.shorekeeper.agent.onEvent((event) => {
      const e = event as { type?: string; state?: AgentPresenceState };
      if (e.type === 'state_update' && e.state) {
        setState(e.state);
        setFeeding(e.state.activity === 'feeding');
      }
    });
    return () => {
      off();
    };
  }, []);

  const handleFeed = useCallback(async () => {
    setFeeding(true);
    try {
      await window.shorekeeper.presence.feed();
    } catch (err) {
      console.error(err);
      setFeeding(false);
    }
  }, []);

  const tokenProgress = useMemo(
    () => Math.min(100, Math.round((state.tokenUsageToday / DAILY_TOKEN_BUDGET) * 100)),
    [state.tokenUsageToday],
  );

  const isActive = state.activity === 'working' || state.activity === 'accompanying';
  const moodRing = MOOD_RING[state.mood];

  return (
    <div className="keeper-panel-shell">
      <AppBackground variant="status" />

      <div className="relative z-10 flex h-full min-h-0 flex-col">
        <PanelTitleBar title={displayName} subtitle="状态面板" />

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-5">
          {/* 角色头像区 */}
          <div className="flex flex-col items-center">
            <div className="relative animate-drift">
              <div
                className={`status-avatar-ring absolute -inset-1.5 rounded-full opacity-80 ${isActive ? 'animate-spin-slow' : ''}`}
              />
              <div
                className={`absolute -inset-1 rounded-full bg-gradient-to-br ${moodRing} opacity-60 blur-md animate-pulse-glow`}
              />
              <AgentAvatar
                size="md"
                className="relative !h-[5.5rem] !w-[5.5rem] border-keeper-cyan/60 shadow-cyan"
              />
              <span
                className={`absolute bottom-1.5 right-1.5 h-3.5 w-3.5 rounded-full border-2 border-keeper-navyDeep ${
                  state.online
                    ? 'bg-emerald-400 shadow-emerald-md'
                    : 'bg-gray-500'
                }`}
                title={state.online ? '在线' : '离线'}
              />
            </div>

            <h2 className="mt-4 text-lg font-semibold tracking-wide text-keeper-ice">{displayName}</h2>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-keeper-cyan/85">
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  state.online ? 'bg-emerald-400 shadow-emerald-sm' : 'bg-gray-500'
                }`}
              />
              {state.online ? '在线' : '离线'}
              <span className="text-keeper-ice/30">·</span>
              <span className="max-w-[160px] truncate text-keeper-ice/65">{state.currentModel}</span>
            </p>
          </div>

          {/* 状态 / 心情 / 羁绊 */}
          <div className="grid grid-cols-3 gap-2">
            <StatCard
              label="状态"
              value={ACTIVITY_LABELS[state.activity]}
              icon={ACTIVITY_ICON[state.activity]}
              accent={
                state.activity === 'working'
                  ? 'from-amber-400/30 to-amber-500/10 text-amber-200'
                  : state.activity === 'feeding'
                    ? 'from-emerald-400/30 to-emerald-500/10 text-emerald-200'
                    : 'from-keeper-cyan/30 to-keeper-cyan/5 text-keeper-cyan'
              }
            />
            <StatCard
              label="心情"
              value={MOOD_LABELS[state.mood]}
              icon={MOOD_ICON[state.mood]}
              accent={`${moodRing} text-keeper-ice`}
            />
            <StatCard
              label="羁绊"
              value={state.affectionStage}
              icon="♡"
              accent="from-rose-400/25 via-keeper-cyan/20 to-rose-300/10 text-rose-100"
            />
          </div>

          {/* Token 用量 */}
          <div className="relative overflow-hidden rounded-2xl border border-keeper-ice/12 bg-gradient-to-br from-keeper-cyan/[0.08] via-white/[0.04] to-transparent p-4 backdrop-blur-md">
            <div className="pointer-events-none absolute -left-6 top-0 h-20 w-20 rounded-full bg-keeper-cyan/15 blur-2xl" />
            <div className="relative flex items-end justify-between gap-3">
              <div>
                <p className="text-[10px] tracking-wider text-keeper-ice/45">今日 Token</p>
                <p className="mt-0.5 text-2xl font-semibold tabular-nums text-keeper-cyan drop-shadow-accent-md">
                  {state.tokenUsageToday.toLocaleString()}
                </p>
              </div>
              <p className="text-[10px] text-keeper-ice/40">{tokenProgress}%</p>
            </div>
            <div className="relative mt-3 h-1.5 overflow-hidden rounded-full bg-keeper-navyDeep/70">
              <div
                className="h-full rounded-full bg-gradient-to-r from-keeper-navy via-keeper-cyan to-keeper-iceDeep transition-all duration-700 ease-out"
                style={{ width: `${Math.max(tokenProgress, state.tokenUsageToday > 0 ? 2 : 0)}%` }}
              />
            </div>
            <p className="relative mt-1.5 text-[10px] text-keeper-ice/35">
              日预算参考 {DAILY_TOKEN_BUDGET.toLocaleString()}
            </p>
          </div>

          {/* 操作区 */}
          <div className="mt-auto space-y-2.5 pt-1">
            <button
              type="button"
              disabled={feeding}
              onClick={handleFeed}
              className="no-drag group relative w-full overflow-hidden rounded-2xl border border-keeper-cyan/35 py-3 text-sm font-medium text-keeper-navyDeep transition disabled:opacity-55"
            >
              <span className="absolute inset-0 bg-gradient-to-r from-keeper-cyan via-keeper-iceDeep to-keeper-cyan bg-[length:200%_100%] transition group-hover:bg-[position:100%_0] group-disabled:bg-[position:0%_0]" />
              <span className="absolute inset-0 opacity-0 transition group-hover:opacity-100 group-disabled:opacity-0">
                <span className="absolute inset-0 bg-white/20" />
              </span>
              <span className="relative flex items-center justify-center gap-2">
                {feeding ? (
                  <>
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-keeper-navyDeep/30 border-t-keeper-navyDeep" />
                    正在享用…
                  </>
                ) : (
                  <>🍵 喂食</>
                )}
              </span>
            </button>

            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => window.shorekeeper.window.show('chat')}
                className="no-drag flex items-center justify-center gap-1.5 rounded-xl border border-keeper-silver/18 bg-keeper-navyDeep/35 py-2.5 text-xs text-keeper-ice/85 backdrop-blur-sm transition hover:border-keeper-cyan/35 hover:bg-keeper-cyan/10 hover:text-keeper-cyan"
              >
                <span className="text-[10px] opacity-70">💬</span>
                聊天
              </button>
              <button
                type="button"
                onClick={() => void window.shorekeeper.window.show('call')}
                className="no-drag flex items-center justify-center gap-1.5 rounded-xl border border-keeper-silver/18 bg-keeper-navyDeep/35 py-2.5 text-xs text-keeper-ice/85 backdrop-blur-sm transition hover:border-keeper-cyan/35 hover:bg-keeper-cyan/10 hover:text-keeper-cyan"
              >
                <span className="text-[10px] opacity-70">📞</span>
                通话
              </button>
              <button
                type="button"
                onClick={() => window.shorekeeper.window.openSettings()}
                className="no-drag flex items-center justify-center gap-1.5 rounded-xl border border-keeper-silver/18 bg-keeper-navyDeep/35 py-2.5 text-xs text-keeper-ice/85 backdrop-blur-sm transition hover:border-keeper-cyan/35 hover:bg-keeper-cyan/10 hover:text-keeper-cyan"
              >
                <span className="text-[10px] opacity-70">⚙</span>
                设置
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
