import { useEffect, useState } from 'react';
import type { AgentPresenceState } from '@/shared/types';

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

export function DockStatusBar() {
  const [state, setState] = useState<AgentPresenceState>(DEFAULT_STATE);

  useEffect(() => {
    window.shorekeeper.presence.get().then(setState).catch(console.error);

    const off = window.shorekeeper.agent.onEvent((event) => {
      const e = event as { type?: string; state?: AgentPresenceState };
      if (e.type === 'state_update' && e.state) {
        setState(e.state);
      }
    });

    return () => {
      off();
    };
  }, []);

  return (
    <div
      data-dock-action="status"
      title="打开状态面板 · 按住拖动可移动"
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        void window.shorekeeper.dock.openStatus();
      }}
      className="flex w-full shrink-0 cursor-grab flex-col gap-0.5 rounded-xl border border-keeper-cyan/20 bg-keeper-navyDeep/75 px-2 py-1.5 backdrop-blur-md transition hover:border-keeper-cyan/35 hover:bg-keeper-navyDeep/90 active:cursor-grabbing"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium tracking-wide text-keeper-cyan/90">状态</span>
        <span className="inline-flex items-center gap-1 text-[10px] text-keeper-ice/40">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              state.online ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]' : 'bg-gray-500'
            }`}
          />
          {state.online ? '在线' : '离线'}
        </span>
      </div>

      <p className="truncate text-[11px] text-keeper-ice/80">
        {ACTIVITY_LABELS[state.activity]} · {MOOD_LABELS[state.mood]}
      </p>
    </div>
  );
}
