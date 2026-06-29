import { useCallback, useEffect, useState } from 'react';
import type { AgentPresenceState } from '@/shared/types';
import { AppBackground } from '../components/AppBackground';
import { PanelTitleBar } from '../components/PanelTitleBar';
import { AgentAvatar } from '../components/AgentAvatar';

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

const DEFAULT_STATE: AgentPresenceState = {
  online: true,
  mood: 'calm',
  activity: 'idle',
  currentModel: '—',
  tokenUsageToday: 0,
};

export function StatusPage() {
  const [state, setState] = useState<AgentPresenceState>(DEFAULT_STATE);
  const [feeding, setFeeding] = useState(false);

  useEffect(() => {
    window.shorekeeper.presence.get().then(setState).catch(console.error);

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

  return (
    <div className="relative h-screen overflow-hidden rounded-3xl border border-keeper-silver/25 shadow-cyanSm">
      <AppBackground />

      <div className="relative z-10 flex h-full min-h-0 flex-col">
        <PanelTitleBar title="守岸人" subtitle="状态面板" />

        <div className="flex flex-1 flex-col items-center gap-5 overflow-y-auto px-5 py-6">
          <div className="relative">
            <AgentAvatar size="md" className="!h-24 !w-24 border-keeper-cyan/50 shadow-cyan" />
            <span
              className={`absolute bottom-1 right-1 h-4 w-4 rounded-full border-2 border-keeper-navyDeep ${
                state.online ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]' : 'bg-gray-500'
              }`}
              title={state.online ? '在线' : '离线'}
            />
          </div>

          <div className="text-center">
            <h2 className="text-lg font-semibold text-keeper-ice">守岸人</h2>
            <p className="text-xs text-keeper-cyan/80">
              {state.online ? '在线' : '离线'} · {state.currentModel}
            </p>
          </div>

          <div className="grid w-full grid-cols-2 gap-3">
            <div className="keeper-glass-soft rounded-2xl px-4 py-3 text-center">
              <p className="text-[10px] tracking-wider text-keeper-ice/50">状态</p>
              <p className="mt-1 text-sm font-medium text-keeper-ice">
                {ACTIVITY_LABELS[state.activity]}
              </p>
            </div>
            <div className="keeper-glass-soft rounded-2xl px-4 py-3 text-center">
              <p className="text-[10px] tracking-wider text-keeper-ice/50">心情</p>
              <p className="mt-1 text-sm font-medium text-keeper-ice">{MOOD_LABELS[state.mood]}</p>
            </div>
          </div>

          <div className="keeper-glass-soft w-full rounded-2xl px-4 py-3 text-center">
            <p className="text-[10px] tracking-wider text-keeper-ice/50">今日 Token</p>
            <p className="mt-1 text-lg font-semibold text-keeper-cyan">
              {state.tokenUsageToday.toLocaleString()}
            </p>
          </div>

          <button
            type="button"
            disabled={feeding}
            onClick={handleFeed}
            className="no-drag w-full rounded-2xl border border-keeper-cyan/30 bg-keeper-cyan/15 py-3 text-sm font-medium text-keeper-cyan transition hover:bg-keeper-cyan/25 disabled:opacity-50"
          >
            {feeding ? '正在享用…' : '🍵 喂食'}
          </button>

          <div className="grid w-full grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => window.shorekeeper.window.show('chat')}
              className="no-drag rounded-xl border border-keeper-silver/20 bg-white/5 py-2.5 text-xs text-keeper-ice hover:border-keeper-cyan/30 hover:text-keeper-cyan"
            >
              打开聊天
            </button>
            <button
              type="button"
              onClick={() => window.shorekeeper.window.openSettings()}
              className="no-drag rounded-xl border border-keeper-silver/20 bg-white/5 py-2.5 text-xs text-keeper-ice hover:border-keeper-cyan/30 hover:text-keeper-cyan"
            >
              设置
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
